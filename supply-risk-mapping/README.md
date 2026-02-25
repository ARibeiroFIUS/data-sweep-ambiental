# Supply Risk Mapping — Análise de Fornecedores

Sistema de due diligence automatizada que cruza bases públicas abertas do governo brasileiro para gerar scores de risco de fornecedores a partir do CNPJ.

Desenvolvido por **FIUS Innovation Hub**.

---

## Como funciona

```
CNPJ do Fornecedor
       │
       ▼
┌─────────────────────────┐
│  Agent 1: QSA Extractor │  ← OpenCNPJ API (Receita Federal)
│  Extrai sócios e admins │
│  Recursão para sócios PJ│
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Agent 2: Sanctions     │  ← CEIS / CNEP / CEPIM (CGU)
│  Scanner de listas      │
│  restritivas            │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Agent 3: PEP Analyzer  │  ← Servidores Federais (CGU)
│  Exposição política     │
│  Conflitos de interesse │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Risk Scorer            │  ← Pondera todos os flags
│  Score 0–100            │
│  Nível: Baixo→Crítico   │
└────────────┬────────────┘
             │
             ▼
    📄 Relatório HTML
    📊 Relatório JSON
```

---

## Setup rápido

### 1. Instalar dependências

```bash
pip install -r requirements.txt
```

### 2. Configurar API do Portal da Transparência

A OpenCNPJ API **não requer chave** (gratuita e aberta).

Para consultar CEIS/CNEP/CEPIM e servidores federais, você precisa de uma chave do Portal da Transparência:

1. Acesse: https://portaldatransparencia.gov.br/api-de-dados
2. Clique em "Cadastre-se" e obtenha sua chave
3. Copie o arquivo de exemplo e preencha:

```bash
cp .env.example .env
# Edite o .env com sua chave
```

> **Sem a chave do Portal**, o sistema ainda funciona — mas apenas com a consulta ao QSA (Receita Federal). As listas CEIS/CNEP/CEPIM e a verificação de servidores ficarão desabilitadas.

### 3. Rodar

```bash
# Modo interativo
python main.py

# CNPJ direto
python main.py 00000000000000

# Batch (múltiplos CNPJs)
python main.py --batch fornecedores.txt

# Batch com CSV consolidado
python main.py --batch fornecedores.txt --csv
```

---

## Bases consultadas

| Base | Órgão | O que verifica | Requer chave? |
|------|-------|----------------|---------------|
| Dados Públicos CNPJ | Receita Federal | QSA, situação cadastral, CNAE, endereço | Não |
| CEIS | CGU | Empresas inidôneas e suspensas | Sim |
| CNEP | CGU | Empresas punidas (Lei Anticorrupção) | Sim |
| CEPIM | CGU | Entidades impedidas | Sim |
| Servidores Federais | CGU | Sócios que são servidores públicos | Sim |

---

## Pesos do Risk Score

| Flag | Peso | Severidade |
|------|------|------------|
| CEIS (empresa inidônea) | 35 | Crítica |
| Trabalho escravo | 35 | Crítica |
| CNEP (Lei Anticorrupção) | 30 | Crítica |
| Sócio em lista restritiva | 30 | Crítica |
| Servidor público (conflito) | 25 | Alta |
| Situação cadastral irregular | 25 | Alta |
| PEP (pessoa exposta) | 20 | Média |
| CEPIM | 15 | Alta |
| Dívida ativa | 15 | Média |
| Empresa recente (< 1 ano) | 10 | Média |
| Muitas empresas vinculadas | 10 | Média |

**Níveis de risco:**
- 🟢 **BAIXO** (0–19): Monitoramento padrão
- 🟡 **MÉDIO** (20–44): Verificação complementar
- 🔴 **ALTO** (45–69): Due diligence aprofundada
- ⛔ **CRÍTICO** (70–100): Não contratar sem parecer jurídico

---

## Estrutura do projeto

```
supply-risk-mapping/
├── main.py                    # Orquestrador principal
├── config.py                  # Configurações e pesos
├── report_generator.py        # Gerador de relatórios HTML/JSON
├── requirements.txt
├── .env.example
├── agents/
│   ├── __init__.py
│   ├── qsa_extractor.py       # Agent 1: Extração de QSA
│   ├── sanctions_scanner.py   # Agent 2: Listas restritivas
│   ├── pep_analyzer.py        # Agent 3: Análise PEP
│   └── risk_scorer.py         # Consolidador de risk score
└── reports/                   # Relatórios gerados (HTML + JSON)
```

---

## Arquivo batch (exemplo)

Crie um arquivo `fornecedores.txt` com um CNPJ por linha:

```
00000000000191
33000167000101
60746948000112
```

---

## Próximos passos (roadmap)

- [ ] Agent 4: Processos judiciais (DataJud/CNJ)
- [ ] Agent 5: Dívida Ativa da União (PGFN)
- [ ] Agent 6: Doações eleitorais (TSE)
- [ ] Agent 7: Multas IBAMA
- [ ] Dashboard web (FastAPI + React)
- [ ] Monitoramento contínuo (cron + alertas)
- [ ] Integração com o sistema de compliance FIUS
- [ ] Exportação para FIUS Innovation Hub

---

## Base legal

Todos os dados utilizados são **públicos e abertos**, disponibilizados por órgãos do governo em conformidade com:

- **Lei de Acesso à Informação** (Lei nº 12.527/2011)
- **Política de Dados Abertos** (Decreto nº 8.777/2016)
- **Marco Civil da Internet** (Lei nº 12.965/2014)

O tratamento de dados respeita a **LGPD** (Lei nº 13.709/2018), utilizando exclusivamente dados de acesso público com finalidade legítima de due diligence e compliance.
