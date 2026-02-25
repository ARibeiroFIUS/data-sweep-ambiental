"""
Report Generator — Gera relatório HTML de risco do fornecedor.
Estilo visual alinhado com a identidade FIUS.
"""
import json
import os
from datetime import datetime
from jinja2 import Template


REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Supply Risk Report — {{ empresa.razao_social }}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');

  :root {
    --dark-blue: #001F3F;
    --primary-blue: #0088CC;
    --accent-teal: #00D4AA;
    --warm-orange: #FF6B35;
    --bg: #0A0F1C;
    --card-bg: rgba(255,255,255,0.04);
    --card-border: rgba(255,255,255,0.08);
    --text: #E8ECF1;
    --text-muted: #8899AA;
    --red: #FF4444;
    --yellow: #FFB800;
    --green: #00D4AA;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Outfit', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
  }

  .container { max-width: 960px; margin: 0 auto; }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem 2rem;
    background: linear-gradient(135deg, var(--dark-blue), rgba(0,136,204,0.15));
    border: 1px solid var(--card-border);
    border-radius: 16px;
    margin-bottom: 2rem;
  }
  .header h1 { font-size: 1.4rem; font-weight: 600; }
  .header .subtitle { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem; }
  .header .badge {
    padding: 0.5rem 1.5rem;
    border-radius: 50px;
    font-weight: 600;
    font-size: 0.9rem;
    letter-spacing: 0.5px;
  }

  /* Score Card */
  .score-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 2rem;
    margin-bottom: 2rem;
    text-align: center;
  }
  .score-circle {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1rem;
    font-size: 2.5rem;
    font-weight: 700;
    border: 4px solid;
  }
  .score-label { font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem; }
  .score-resumo {
    color: var(--text-muted);
    font-size: 0.9rem;
    max-width: 700px;
    margin: 1rem auto 0;
    line-height: 1.7;
  }

  /* Info Grid */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .info-item {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 1.2rem;
  }
  .info-item .label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; }
  .info-item .value { font-size: 1rem; font-weight: 500; margin-top: 0.3rem; }

  /* Section */
  .section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 1.5rem 2rem;
    margin-bottom: 1.5rem;
  }
  .section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--card-border);
    color: var(--primary-blue);
  }

  /* Flags */
  .flag {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    border-radius: 10px;
    margin-bottom: 0.75rem;
    border-left: 3px solid;
  }
  .flag.critica { background: rgba(255,68,68,0.08); border-color: var(--red); }
  .flag.alta { background: rgba(255,107,53,0.08); border-color: var(--warm-orange); }
  .flag.media { background: rgba(255,184,0,0.08); border-color: var(--yellow); }
  .flag.baixa { background: rgba(0,212,170,0.08); border-color: var(--green); }
  .flag .icon { font-size: 1.3rem; flex-shrink: 0; }
  .flag .content { flex: 1; }
  .flag .flag-title { font-weight: 600; font-size: 0.9rem; }
  .flag .flag-desc { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.2rem; }
  .flag .flag-peso { color: var(--text-muted); font-size: 0.75rem; margin-top: 0.3rem; }

  /* Sócios Table */
  .socios-table { width: 100%; border-collapse: collapse; }
  .socios-table th {
    text-align: left;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0.75rem;
    border-bottom: 1px solid var(--card-border);
  }
  .socios-table td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--card-border);
    font-size: 0.9rem;
  }
  .socios-table tr:last-child td { border-bottom: none; }
  .badge-pf { color: var(--primary-blue); }
  .badge-pj { color: var(--accent-teal); }

  /* Footer */
  .footer {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.75rem;
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--card-border);
  }

  /* No flags */
  .no-flags {
    text-align: center;
    color: var(--green);
    padding: 2rem;
    font-size: 1rem;
  }

  @media print {
    body { background: #fff; color: #222; padding: 1rem; }
    .header, .score-card, .section, .info-item, .flag {
      background: #f8f9fa; border-color: #ddd; color: #222;
    }
    .flag .flag-desc, .score-resumo, .info-item .label, .footer { color: #666; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <div>
      <h1>Supply Risk Report</h1>
      <div class="subtitle">Gerado em {{ data_geracao }} | Supply Risk Mapping v1.0</div>
    </div>
    <div class="badge" style="background: {{ risk.cor }}22; color: {{ risk.cor }}; border: 1px solid {{ risk.cor }}44;">
      {{ risk.nivel }}
    </div>
  </div>

  <!-- Score -->
  <div class="score-card">
    <div class="score-circle" style="color: {{ risk.cor }}; border-color: {{ risk.cor }}33;">
      {{ risk.score }}
    </div>
    <div class="score-label">Risk Score (0–100)</div>
    <div class="score-resumo">{{ risk.resumo }}</div>
  </div>

  <!-- Dados da Empresa -->
  <div class="info-grid">
    <div class="info-item">
      <div class="label">Razão Social</div>
      <div class="value">{{ empresa.razao_social }}</div>
    </div>
    <div class="info-item">
      <div class="label">CNPJ</div>
      <div class="value">{{ empresa.cnpj }}</div>
    </div>
    <div class="info-item">
      <div class="label">Situação</div>
      <div class="value">{{ empresa.situacao_cadastral }}</div>
    </div>
    <div class="info-item">
      <div class="label">Data de Abertura</div>
      <div class="value">{{ empresa.data_abertura }}</div>
    </div>
    <div class="info-item">
      <div class="label">CNAE Principal</div>
      <div class="value">{{ empresa.cnae_principal }}</div>
    </div>
    <div class="info-item">
      <div class="label">Localização</div>
      <div class="value">{{ empresa.municipio }} / {{ empresa.uf }}</div>
    </div>
  </div>

  <!-- Quadro Societário -->
  <div class="section">
    <h2>Quadro Societário (QSA)</h2>
    {% if empresa.socios %}
    <table class="socios-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Tipo</th>
          <th>Qualificação</th>
          <th>Doc</th>
        </tr>
      </thead>
      <tbody>
        {% for socio in empresa.socios %}
        <tr>
          <td>{{ socio.nome }}</td>
          <td><span class="badge-{{ socio.tipo|lower }}">{{ socio.tipo }}</span></td>
          <td>{{ socio.qualificacao }}</td>
          <td>{{ socio.cpf_cnpj_formatado }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
    {% else %}
    <p style="color: var(--text-muted);">Nenhum sócio encontrado no QSA.</p>
    {% endif %}
  </div>

  <!-- Flags de Risco -->
  <div class="section">
    <h2>Flags de Risco Identificados ({{ risk.total_flags }})</h2>
    {% if risk.detalhes %}
      {% for d in risk.detalhes %}
      <div class="flag {{ d.severidade|lower }}">
        <div class="icon">
          {% if d.severidade == 'CRITICA' %}⛔
          {% elif d.severidade == 'ALTA' %}🔴
          {% elif d.severidade == 'MEDIA' %}🟡
          {% else %}🟢{% endif %}
        </div>
        <div class="content">
          <div class="flag-title">{{ d.flag }}</div>
          <div class="flag-desc">{{ d.descricao }}</div>
          <div class="flag-peso">Peso no score: +{{ d.peso }} pontos</div>
        </div>
      </div>
      {% endfor %}
    {% else %}
      <div class="no-flags">✓ Nenhum flag de risco identificado nas bases consultadas.</div>
    {% endif %}
  </div>

  <!-- Bases Consultadas -->
  <div class="section">
    <h2>Bases de Dados Consultadas</h2>
    <table class="socios-table">
      <thead><tr><th>Base</th><th>Órgão</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Dados Públicos CNPJ</td><td>Receita Federal</td><td>✓ Consultado</td></tr>
        <tr><td>CEIS</td><td>CGU</td><td>{{ '✓ Consultado' if api_configurada else '⚠ API não configurada' }}</td></tr>
        <tr><td>CNEP</td><td>CGU</td><td>{{ '✓ Consultado' if api_configurada else '⚠ API não configurada' }}</td></tr>
        <tr><td>CEPIM</td><td>CGU</td><td>{{ '✓ Consultado' if api_configurada else '⚠ API não configurada' }}</td></tr>
        <tr><td>Servidores Federais</td><td>CGU</td><td>{{ '✓ Consultado' if api_configurada else '⚠ API não configurada' }}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Disclaimer -->
  <div class="footer">
    <p>
      Este relatório é gerado automaticamente com base em dados públicos abertos.
      Não constitui parecer jurídico. Os resultados devem ser validados por um profissional
      de compliance antes de qualquer decisão de contratação.
    </p>
    <p style="margin-top: 0.5rem;">
      Supply Risk Mapping — FIUS Innovation Hub | {{ data_geracao }}
    </p>
  </div>

</div>
</body>
</html>"""


def gerar_relatorio_html(empresa: dict, risk: dict, api_configurada: bool = False) -> str:
    """
    Gera relatório HTML completo.

    Returns:
        Caminho do arquivo HTML gerado.
    """
    template = Template(REPORT_TEMPLATE)

    cnpj_limpo = empresa.get("cnpj", "").replace(".", "").replace("/", "").replace("-", "")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"risk_report_{cnpj_limpo}_{timestamp}.html"
    filepath = os.path.join("reports", filename)

    os.makedirs("reports", exist_ok=True)

    html = template.render(
        empresa=empresa,
        risk=risk,
        api_configurada=api_configurada,
        data_geracao=datetime.now().strftime("%d/%m/%Y às %H:%M"),
    )

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html)

    return filepath


def gerar_relatorio_json(empresa: dict, sancoes: dict, pep_results: list, risk: dict) -> str:
    """Gera relatório JSON para integração com outros sistemas."""
    cnpj_limpo = empresa.get("cnpj", "").replace(".", "").replace("/", "").replace("-", "")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"risk_report_{cnpj_limpo}_{timestamp}.json"
    filepath = os.path.join("reports", filename)

    os.makedirs("reports", exist_ok=True)

    report = {
        "metadata": {
            "versao": "1.0",
            "data_geracao": datetime.now().isoformat(),
            "sistema": "Supply Risk Mapping — FIUS Innovation Hub",
        },
        "empresa": empresa,
        "sancoes": sancoes,
        "pep": pep_results,
        "risk_score": risk,
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)

    return filepath
