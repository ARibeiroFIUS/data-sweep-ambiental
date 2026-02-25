"""
Supply Risk Mapping — Configuração Central
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ── API Keys ──────────────────────────────────────────────────
PORTAL_TRANSPARENCIA_API_KEY = os.getenv("PORTAL_TRANSPARENCIA_API_KEY", "")

# ── Endpoints ─────────────────────────────────────────────────
OPENCNPJ_BASE = "https://api.opencnpj.org"

PORTAL_TRANSPARENCIA_BASE = "https://api.portaldatransparencia.gov.br/api-de-dados"
CEIS_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/ceis"
CNEP_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/cnep"
CEPIM_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/cepim"
SERVIDORES_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/servidores"
LICITACOES_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/licitacoes"
CONTRATOS_ENDPOINT = f"{PORTAL_TRANSPARENCIA_BASE}/contratos"

# ── Rate Limiting ─────────────────────────────────────────────
# Portal da Transparência: 90 req/min (06h-23h59), 300 req/min (00h-05h59)
PORTAL_RATE_LIMIT_DAY = 80       # margem de segurança
PORTAL_RATE_LIMIT_NIGHT = 280
OPENCNPJ_RATE_LIMIT = 30         # req/min (conservador)

# ── Risk Score Weights ────────────────────────────────────────
RISK_WEIGHTS = {
    "ceis":              35,   # Empresa inidônea — gravíssimo
    "cnep":              30,   # Punida pela Lei Anticorrupção
    "cepim":             15,   # Entidade impedida
    "trabalho_escravo":  35,   # Lista suja — gravíssimo
    "pep":               20,   # Pessoa exposta politicamente
    "servidor_publico":  25,   # Conflito de interesses
    "divida_ativa":      15,   # Problema financeiro
    "socio_em_lista":    30,   # Sócio em lista restritiva
    "empresa_recente":   10,   # Aberta há menos de 1 ano
    "muitas_empresas":   10,   # Sócio em 5+ empresas
    "situacao_irregular": 25,  # CNPJ não ativo
}

# ── Risk Thresholds ───────────────────────────────────────────
RISK_LEVELS = {
    "CRITICO":  70,
    "ALTO":     45,
    "MEDIO":    20,
    "BAIXO":     0,
}

# ── Headers padrão Portal da Transparência ────────────────────
def portal_headers():
    return {
        "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
        "Accept": "application/json",
    }
