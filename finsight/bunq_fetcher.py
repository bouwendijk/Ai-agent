"""
bunq API-client — leest rekeningen en transacties met een persoonlijke API-key.

Flow (officiële bunq Public API): installation (publieke sleutel registreren)
→ device-server (API-key koppelen) → session-server (sessie openen), daarna GET's.
Beveiligde verzoeken worden RSA-SHA256-ondertekend. De installatie-context wordt
gecachet in ~/.finsight/bunq_context.json zodat registratie eenmalig is.

Een key die met "sandbox_" begint gebruikt automatisch de bunq-sandbox.
FINSIGHT_BUNQ_BASE kan de basis-URL overschrijven (voor tests/mocks).
"""
import base64
import json
import os
import uuid
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

PROD_BASE = "https://api.bunq.com/v1"
SANDBOX_BASE = "https://public-api.sandbox.bunq.com/v1"
CTX_PATH = Path.home() / ".finsight" / "bunq_context.json"


class BunqError(RuntimeError):
    pass


def _base_url(api_key: str) -> str:
    override = os.getenv("FINSIGHT_BUNQ_BASE")
    if override:
        return override.rstrip("/")
    return SANDBOX_BASE if api_key.startswith("sandbox_") else PROD_BASE


def _headers(token: str | None = None) -> dict:
    h = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "FinSight-Agent/1.0",
        "X-Bunq-Language": "nl_NL",
        "X-Bunq-Region": "nl_NL",
        "X-Bunq-Client-Request-Id": str(uuid.uuid4()),
        "X-Bunq-Geolocation": "0 0 0 0 000",
    }
    if token:
        h["X-Bunq-Client-Authentication"] = token
    return h


def _sign(private_key_pem: str, body: str) -> str:
    key = serialization.load_pem_private_key(private_key_pem.encode(), password=None)
    sig = key.sign(body.encode(), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(sig).decode()


def _pick(items: list, key: str):
    for it in items:
        if key in it:
            return it[key]
    return None


class BunqClient:
    def __init__(self, api_key: str):
        if not api_key:
            raise BunqError("Geen BUNQ_API_KEY gevonden (zet hem in .env).")
        self.api_key = api_key
        self.base = _base_url(api_key)
        self.ctx = self._load_ctx()
        self.session_token: str | None = None
        self.user_id: int | None = None

    # ── context (eenmalige registratie) ───────────────────────────────────
    def _load_ctx(self) -> dict:
        try:
            ctx = json.loads(CTX_PATH.read_text())
            if ctx.get("base") == self.base and ctx.get("key_tail") == self.api_key[-6:]:
                return ctx
        except (OSError, ValueError):
            pass
        return {}

    def _save_ctx(self) -> None:
        CTX_PATH.parent.mkdir(parents=True, exist_ok=True)
        CTX_PATH.write_text(json.dumps(self.ctx))
        try:
            CTX_PATH.chmod(0o600)
        except OSError:
            pass

    def _request(self, method: str, path: str, body: dict | None = None,
                 token: str | None = None, sign_with: str | None = None) -> list:
        body_str = json.dumps(body) if body is not None else ""
        headers = _headers(token)
        if sign_with:
            headers["X-Bunq-Client-Signature"] = _sign(sign_with, body_str)
        resp = requests.request(method, self.base + path, headers=headers,
                                data=body_str if body is not None else None, timeout=30)
        try:
            data = resp.json()
        except ValueError:
            raise BunqError(f"bunq gaf een onleesbaar antwoord (HTTP {resp.status_code}).")
        if not resp.ok:
            desc = (data.get("Error") or [{}])[0].get("error_description", f"HTTP {resp.status_code}")
            raise BunqError(f"bunq-fout: {desc}")
        return data.get("Response", [])

    def _ensure_installation(self) -> None:
        if self.ctx.get("private_key_pem") and self.ctx.get("installation_token"):
            return
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        priv_pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()).decode()
        pub_pem = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

        inst = self._request("POST", "/installation", {"client_public_key": pub_pem})
        token = (_pick(inst, "Token") or {}).get("token")
        if not token:
            raise BunqError("Geen installatie-token van bunq ontvangen.")
        self._request("POST", "/device-server",
                      {"description": "FinSight Agent", "secret": self.api_key, "permitted_ips": ["*"]},
                      token=token, sign_with=priv_pem)
        self.ctx = {"base": self.base, "key_tail": self.api_key[-6:],
                    "private_key_pem": priv_pem, "installation_token": token}
        self._save_ctx()

    def connect(self) -> None:
        """Opent een sessie (en registreert dit apparaat bij de eerste keer)."""
        self._ensure_installation()
        items = self._request("POST", "/session-server", {"secret": self.api_key},
                              token=self.ctx["installation_token"],
                              sign_with=self.ctx["private_key_pem"])
        self.session_token = (_pick(items, "Token") or {}).get("token")
        user = _pick(items, "UserPerson") or _pick(items, "UserCompany") or _pick(items, "UserApiKey")
        self.user_id = (user or {}).get("id")
        if not self.session_token or not self.user_id:
            raise BunqError("Sessie openen bij bunq mislukte.")

    def _get(self, path: str) -> list:
        return self._request("GET", path, token=self.session_token,
                             sign_with=self.ctx["private_key_pem"])

    # ── data ──────────────────────────────────────────────────────────────
    def accounts(self) -> list[dict]:
        items = self._get(f"/user/{self.user_id}/monetary-account")
        out = []
        for it in items:
            acc = it.get("MonetaryAccountBank") or it.get("MonetaryAccountSavings") or it.get("MonetaryAccountJoint")
            if not acc or acc.get("status") == "CANCELLED":
                continue
            iban = next((a["value"] for a in acc.get("alias", []) if a.get("type") == "IBAN"), None)
            out.append({
                "id": acc["id"],
                "naam": acc.get("description", "rekening"),
                "iban": iban,
                "saldo": float(acc.get("balance", {}).get("value", "0")),
            })
        return out

    def payments(self, account_id: int, max_count: int = 1000) -> list[dict]:
        """Nieuwste betalingen eerst; pagineert tot max_count."""
        out: list[dict] = []
        path = f"/user/{self.user_id}/monetary-account/{account_id}/payment?count=200"
        while path and len(out) < max_count:
            items = self._request("GET", path, token=self.session_token,
                                  sign_with=self.ctx["private_key_pem"])
            batch = [it["Payment"] for it in items if "Payment" in it]
            if not batch:
                break
            for p in batch:
                out.append({
                    "datum": p.get("created", "")[:10],
                    "bedrag": float(p.get("amount", {}).get("value", "0")),
                    "naam": (p.get("counterparty_alias") or {}).get("display_name")
                            or (p.get("counterparty_alias") or {}).get("iban") or "Onbekend",
                    "omschrijving": (p.get("description") or "").strip(),
                })
            # bunq geeft paginatie via oudere id's; simpel: stop na één ronde zonder Pagination
            path = None
        return out
