# Sistema Multiagentes de Compliance Ambiental

> Documentação técnica completa para construção de um sistema que automatiza a verificação de enquadramento em licenciamento ambiental federal, estadual (SP) e municipal, a partir do CNPJ de uma empresa.

---

## 1. Visão Geral da Arquitetura

O sistema é composto por **5 agentes sequenciais**, cada um responsável por uma camada de verificação regulatória. O output de um agente alimenta o seguinte:

```
CNPJ (input do usuário)
    │
    ▼
┌─────────────────────────────────┐
│  AGENTE 1 — Consulta CNPJ/CNAE │  ← APIs públicas (Receita Federal)
└──────────────┬──────────────────┘
               │ CNAEs (principal + secundários)
               ▼
┌─────────────────────────────────┐
│  AGENTE 2 — IBAMA / CTF / FTE  │  ← Enquadramento federal
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  AGENTE 3 — CETESB (SP)        │  ← Licenciamento estadual
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  AGENTE 4 — Municipal           │  ← LC 140/2011 + CONSEMA 01/2024
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  AGENTE 5 — Áreas Contaminadas  │  ← SEMIL / SIGAM / CETESB GEO
└─────────────────────────────────┘
               │
               ▼
         RELATÓRIO FINAL
```

---

## 2. Agente 1 — Consulta CNPJ e Extração de CNAEs

### Objetivo

Dado um CNPJ, buscar via API pública os dados cadastrais da empresa e extrair todos os CNAEs (principal e secundários).

### APIs Disponíveis (gratuitas, sem autenticação)

| API | Endpoint | Limite | Observações |
|-----|----------|--------|-------------|
| **BrasilAPI** | `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` | Sem limite publicado | Open source, CDN global, dados atualizados mensalmente |
| **OpenCNPJ** | `GET https://api.opencnpj.org/{cnpj}` | 50 req/s por IP | Base atualizada mensalmente via dump da RFB |
| **ReceitaWS** | `GET https://receitaws.com.br/v1/cnpj/{cnpj}` | 3 req/min (free) | Requer headers específicos |

### Estratégia de Fallback

```
BrasilAPI → (falhou?) → OpenCNPJ → (falhou?) → ReceitaWS → Erro
```

### Campos Relevantes do Retorno (BrasilAPI)

```json
{
  "razao_social": "EMPRESA EXEMPLO LTDA",
  "nome_fantasia": "EXEMPLO",
  "cnae_fiscal": 2014200,
  "cnae_fiscal_descricao": "Fabricação de gases industriais",
  "cnaes_secundarios": [
    { "codigo": 2019399, "descricao": "Fabricação de outros produtos químicos..." },
    { "codigo": 4681801, "descricao": "Comércio atacadista de álcool carburante..." }
  ],
  "logradouro": "RUA EXEMPLO",
  "municipio": "SÃO PAULO",
  "uf": "SP",
  "descricao_situacao_cadastral": "ATIVA"
}
```

### Repositórios e Recursos

- **BrasilAPI**: https://github.com/BrasilAPI/BrasilAPI
- **OpenCNPJ**: https://opencnpj.org/ (disponibiliza também dump completo em ZIP ~550 GB e dataset BigQuery)
- **CNAE IBGE (busca oficial)**: https://cnae.ibge.gov.br/
- **Python client BrasilAPI**: https://github.com/jaswdr/brasil-api

### Nota Importante

Os CNAEs registrados no CNPJ **não determinam** por si só as obrigações ambientais. Conforme a IN Ibama nº 13/2021 (Art. 2.1.3): *"A obrigação de inscrição no CTF/APP não se vincula à CNAE, que pode ser utilizada como referência de enquadramento."* O agente deve tratar os CNAEs como **indicadores**, não como determinantes.

---

## 3. Agente 2 — IBAMA: Enquadramento Federal (CTF/APP e FTE)

### Objetivo

Verificar se os CNAEs da empresa correspondem a atividades potencialmente poluidoras listadas nas Fichas Técnicas de Enquadramento (FTE) do IBAMA, organizadas nas 20 categorias do Anexo VIII da Lei nº 6.938/1981.

### As 20 Categorias do CTF/APP

| Cat. | Nome | Divisões CNAE Correlatas |
|------|------|--------------------------|
| 1 | Extração e Tratamento de Minerais | 05, 06, 07, 08, 09 |
| 2 | Indústria de Produtos Minerais Não Metálicos | 23 |
| 3 | Indústria Metalúrgica | 24 |
| 4 | Indústria Mecânica | 25, 28 |
| 5 | Indústria de Material Elétrico, Eletrônico e Comunicações | 26, 27 |
| 6 | Indústria de Material de Transporte | 29, 30 |
| 7 | Indústria de Madeira | 16 |
| 8 | Indústria de Papel e Celulose | 17 |
| 9 | Indústria de Borracha | 22.1 |
| 10 | Indústria de Couros e Peles | 15.1 |
| 11 | Indústria Têxtil, Vestuário, Calçados e Artefatos de Tecidos | 13, 15.2–15.4 |
| 12 | Indústria de Produtos de Matéria Plástica | 22.2 |
| 13 | Indústria do Fumo | 12 |
| 14 | Indústrias Diversas | 32 |
| 15 | Indústria Química | 20, 21 |
| 16 | Indústria de Produtos Alimentares e Bebidas | 10, 11 |
| 17 | Serviços de Utilidade | 35, 36, 37, 38, 39 |
| 18 | Transporte, Terminais, Depósitos e Comércio | 49, 50, 51, 52 |
| 19 | Turismo | 55, 79 |
| 20 | Uso de Recursos Naturais | 01, 02, 03 |

> **Categorias 21–23** cobrem atividades adicionais: silvicultura, obras civis e empreendimentos sujeitos a licenciamento ambiental federal (usinas, rodovias, portos, mineração, petróleo, nuclear etc.).

### Fontes de Dados

| Recurso | URL |
|---------|-----|
| FTEs por Categoria (portal oficial) | https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias |
| Tabela Completa de Atividades (PDF) | https://www.ibama.gov.br/phocadownload/qualidadeambiental/relatorios/2009/2019-03-06-Ibama-Tabela-FTE%20-completa.pdf |
| Passo a passo do enquadramento | https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/enquadramento-passo-a-passo |
| IN Ibama nº 13/2021 (RE-CTF/APP) | Regulamento vigente do enquadramento |
| IN Ibama nº 12/2018 (estrutura FTE) | Estrutura e campos das FTEs |

### Lógica do Agente

```
Para cada CNAE:
  1. Extrair divisão (2 dígitos), grupo (3 dígitos), classe (4 dígitos)
  2. Comparar com prefixos CNAE de cada categoria FTE
  3. Se match por código → risco ALTO
  4. Se match por keyword na descrição → risco MÉDIO
  5. Gerar link direto para a FTE da categoria correspondente
```

### Campos Relevantes de cada FTE

Cada FTE contém: "A descrição compreende", "A descrição não compreende", "Definições e linhas de corte", "CNAE", "Observações", "Referências Normativas". O agente deve orientar o usuário a consultar esses campos para confirmação.

---

## 4. Agente 3 — CETESB: Licenciamento Ambiental Estadual (SP)

### Objetivo

Verificar se os CNAEs se enquadram como **fontes de poluição** conforme o Anexo 5 do Regulamento da Lei nº 997/76 (Decreto nº 8.468/76, alterado pelo Decreto nº 47.397/02), o que torna obrigatório o licenciamento ambiental estadual (LP, LI, LO).

### Base Legal

| Norma | Conteúdo |
|-------|----------|
| **Lei Estadual nº 997/76** | Controle da poluição do meio ambiente em SP |
| **Decreto nº 8.468/76** | Regulamento da Lei 997/76 |
| **Decreto nº 47.397/02** | Alterações ao regulamento |
| **Anexo 5** | Lista de atividades consideradas fontes de poluição |
| **Anexo 10** | Empreendimentos com LP precedente obrigatória à LI |
| **Lei Estadual nº 1.817/78** | Restrições na RMSP |
| **Lei nº 9.825/97** | Restrições em áreas de drenagem do Rio Piracicaba |

### Fontes de Dados

| Recurso | URL |
|---------|-----|
| Atividades que devem ser licenciadas | https://licenciamento.cetesb.sp.gov.br/cetesb/atividades_empreendimentos.asp |
| Atividades passíveis de licenciamento (PDF com CNAEs) | https://cetesb.sp.gov.br/licenciamentoambiental/wp-content/uploads/sites/32/2025/02/Atividades-passiveis-de-licenciamento.pdf |
| Portal de Licenciamento Ambiental | https://cetesb.sp.gov.br/licenciamentoambiental/ |
| Atividades com Avaliação de Impacto Ambiental | https://cetesb.sp.gov.br/licenciamentoambiental/quem-deve-solicitar/atividades-empreendimentos-sujeitos-ao-licenciamento-com-avaliacao-de-impacto-ambiental/ |
| Atividades delegadas a municípios | https://cetesb.sp.gov.br/licenciamentoambiental/atividades-cujo-o-licenciamento-a-cetesb-delegou-para-o-municipio/ |

### Lógica do Agente

```
Para cada CNAE:
  1. Verificar se a divisão (2 dígitos) está no Anexo 5
  2. Verificar se a atividade específica (4-7 dígitos) está na tabela CETESB
  3. Checar necessidade de LP precedente (Anexo 10)
  4. Alertar sobre restrições RMSP (divisões 19, 20, 23, 24 etc.)
  5. Alertar sobre restrições Rio Piracicaba
```

### Definições Legais Relevantes

**Fontes de poluição** (Art. 4º, Decreto 8.468/76): todas as obras, atividades, instalações, empreendimentos, processos, dispositivos, móveis ou imóveis, ou meios de transportes que, direta ou indiretamente, causem ou possam causar poluição ao meio ambiente.

**Poluição** (Art. 2º, Lei 997/76): presença, lançamento ou liberação, nas águas, no ar ou no solo, de toda e qualquer forma de matéria ou energia em desacordo com os padrões estabelecidos.

---

## 5. Agente 4 — Licenciamento Ambiental Municipal

### Objetivo

Verificar se a atividade é de **impacto ambiental local** e se o licenciamento compete ao município, conforme a Lei Complementar nº 140/2011 e a Deliberação Normativa CONSEMA nº 01/2024 (SP).

### Base Legal

| Norma | Conteúdo |
|-------|----------|
| **LC nº 140/2011** | Fixa competências dos entes federativos para licenciamento |
| **DN CONSEMA nº 01/2024** | Tipologia para licenciamento municipal em SP (vigente desde 10/05/2024) |
| **LGLA (proposta)** | Lei Geral do Licenciamento Ambiental (em tramitação) |

### Estrutura da DN CONSEMA 01/2024

A deliberação organiza as atividades em:

**Anexo I — Tipologia de atividades de impacto local:**
- **Item I** — Atividades não industriais (obras viárias, terminais logísticos, loteamentos, estações de tratamento, postos de combustível, sistemas de drenagem etc.)
- **Item II** — Atividades industriais por código CNAE (lista extensa de subclasses CNAE passíveis de licenciamento municipal)

**Anexo II — Classificação de impacto:**
- Baixo impacto
- Médio impacto
- Alto impacto

**Anexo III — Requisitos para habilitação do município:**
- Conselho de Meio Ambiente
- Corpo técnico concursado
- Legislação municipal compatibilizada

### Fontes de Dados

| Recurso | URL |
|---------|-----|
| LC 140/2011 (texto integral) | https://www.planalto.gov.br/ccivil_03/leis/LCP/Lcp140.htm |
| DN CONSEMA 01/2024 (PDF oficial) | https://smastr16.blob.core.windows.net/home/2024/03/Deliberacao-Normativa-CONSEMA-01_2024-assinada.pdf |
| Municípios habilitados | https://semil.sp.gov.br/consema/licenciamento-ambiental-municipal/ |
| Resolução CADES 284/2024 (São Paulo capital) | https://legislacao.prefeitura.sp.gov.br/leis/resolucao-secretaria-municipal-do-verde-e-do-meio-ambiente-svma-cades-284-de-20-de-dezembro-de-2024 |

### Lógica do Agente

```
Para cada CNAE:
  1. Checar se está na lista de CNAEs industriais do Anexo I, item II da DN CONSEMA
  2. Checar se se enquadra em atividades não industriais (Anexo I, item I)
  3. Verificar se o município é habilitado (lista CONSEMA)
  4. Se município não habilitado → competência volta para CETESB
  5. Atenção: Art. 16 da DN → se há CNAE industrial secundário não listado,
     o licenciamento vai para a CETESB
```

### Regra Crítica (Art. 16 da DN CONSEMA 01/2024)

Se constar no CNPJ do empreendimento alguma **atividade industrial secundária** efetivamente desenvolvida e com código CNAE **não listado** no Anexo I, item II, o licenciamento ambiental do empreendimento será de competência da **CETESB** (não do município).

---

## 6. Agente 5 — Verificação de Áreas Contaminadas

### Objetivo

Orientar a consulta georreferenciada para verificar se o endereço do empreendimento está localizado em área contaminada, com suspeita de contaminação, ou reabilitada.

### Por que não há API?

Os sistemas de áreas contaminadas do Estado de São Paulo (SIGAMGEO, mapa SEMIL) são aplicações web interativas baseadas em ArcGIS WebAppViewer. Não expõem endpoints REST públicos para consulta automatizada. A verificação precisa ser feita **manualmente** nos portais georreferenciados.

### Sistemas de Consulta

| Sistema | URL | Tipo |
|---------|-----|------|
| **Mapa Interativo SEMIL** | https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=77da778c122c4ccda8a8d6babce61b63 | Mapa GIS |
| **SIGAM — Áreas Contaminadas** | https://sigam.ambiente.sp.gov.br/sigam3/Default.aspx?idPagina=17676 | Busca textual |
| **Relação oficial CETESB** | https://cetesb.sp.gov.br/areas-contaminadas/relacao-de-areas-contaminadas/ | Relatório + mapa |
| **GeoSampa** (SP capital) | https://geosampa.prefeitura.sp.gov.br/ | Mapa municipal |
| **Manual GAC (CETESB)** | https://cetesb.sp.gov.br/areas-contaminadas/documentacao/manual-de-gerenciamento-de-areas-contaminadas/ | Documentação |

### Base Legal

| Norma | Conteúdo |
|-------|----------|
| **Lei Estadual nº 13.577/2009** | Proteção da qualidade do solo e gerenciamento de áreas contaminadas |
| **Decreto nº 59.263/2013** | Regulamenta a Lei 13.577/2009 |
| **IT nº 039 CETESB** | Atividades Prioritárias para Gerenciamento de Áreas Contaminadas |

### Lógica do Agente

```
1. Receber endereço do empreendimento (output do Agente 1)
2. Gerar links diretos para os 4 sistemas de consulta
3. Orientar o usuário sobre quais camadas ativar em cada sistema
4. Se município for São Paulo → incluir orientação GeoSampa + SIGAC (PMSP)
5. Alertar sobre implicações:
   - Área contaminada → restrições de uso
   - Art. 26 da DN CONSEMA 01/2024 → licenciamento condicionado a manifestação CETESB
```

---

## 7. Fontes de Dados Consolidadas

### APIs Públicas

| Serviço | Endpoint Base | Auth | Limite | Dados |
|---------|---------------|------|--------|-------|
| BrasilAPI | `brasilapi.com.br/api/cnpj/v1/` | Não | ~ilimitado | CNPJ, CNAEs, endereço |
| OpenCNPJ | `api.opencnpj.org/` | Não | 50 req/s | CNPJ, CNAEs (atualização mensal) |
| ReceitaWS | `receitaws.com.br/v1/cnpj/` | Não | 3 req/min | CNPJ básico |
| CNPJá (free tier) | `open.cnpja.com/office/` | Não | Limitado | Dados cadastrais |
| CNAE IBGE | `cnae.ibge.gov.br/` | Não | Web only | Hierarquia e notas explicativas |

### Bases de Dados Offline

| Base | URL/Recurso | Formato |
|------|-------------|---------|
| Dump completo CNPJ (RFB) | Via OpenCNPJ ou dados.gov.br | ZIP (~550 GB descompactado) |
| Tabela FTE completa (IBAMA) | PDF no site do IBAMA | PDF |
| Tabela atividades CETESB | PDF no portal de licenciamento | PDF |
| DN CONSEMA 01/2024 | PDF oficial | PDF |
| Áreas contaminadas CETESB | SIGAMGEO (tempo real) | WebApp GIS |

### Repositórios GitHub Úteis

| Repo | Linguagem | Uso |
|------|-----------|-----|
| [BrasilAPI/BrasilAPI](https://github.com/BrasilAPI/BrasilAPI) | JavaScript | API unificada de dados BR |
| [br-api/empresas-brasil](https://github.com/br-api/empresas-brasil) | Python | Client Python para consulta CNPJ |
| [jaswdr/brasil-api](https://github.com/jaswdr/brasil-api) | Python | Client Python da BrasilAPI |

---

## 8. Estrutura de Dados Sugerida

### Output do Pipeline Completo

```json
{
  "cnpj": "33.000.167/0001-01",
  "empresa": {
    "razao_social": "PETRÓLEO BRASILEIRO S A PETROBRAS",
    "situacao": "ATIVA",
    "endereco": "AV REPUBLICA DO CHILE, 65 - CENTRO, RIO DE JANEIRO/RJ",
    "cnaes": [
      { "codigo": "0600001", "descricao": "Extração de petróleo e gás natural", "principal": true },
      { "codigo": "1921700", "descricao": "Fabricação de produtos do refino...", "principal": false }
    ]
  },
  "ibama": {
    "enquadrado": true,
    "matches": [
      {
        "categoria": 1,
        "nome": "Extração e Tratamento de Minerais",
        "cnae_match": "0600001",
        "risco": "alto",
        "link_fte": "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias"
      }
    ]
  },
  "cetesb": {
    "enquadrado": true,
    "lp_precedente": true,
    "rmsp_restricoes": false,
    "matches": [
      { "cnae": "0600001", "tipo": "Anexo 5 - Fonte de Poluição", "risco": "alto" }
    ]
  },
  "municipal": {
    "enquadrado": false,
    "nota": "Atividades de grande porte - competência federal/estadual"
  },
  "areas_contaminadas": {
    "consulta_manual_necessaria": true,
    "links": ["https://mapas.semil.sp.gov.br/...", "https://sigam.ambiente.sp.gov.br/..."]
  }
}
```

---

## 9. Considerações para Implementação com LLM (Claude)

Para transformar este sistema em agentes inteligentes usando a API da Anthropic, cada agente pode ser um **tool call** ou uma **etapa de prompt chain**:

```
System prompt → define o papel de consultor ambiental
Tool 1: fetch_cnpj(cnpj) → retorna CNAEs
Tool 2: check_ibama(cnaes) → retorna enquadramento FTE
Tool 3: check_cetesb(cnaes) → retorna enquadramento estadual
Tool 4: check_municipal(cnaes, municipio) → retorna competência
Tool 5: check_areas(endereco) → retorna links de consulta
```

O LLM pode ser usado para a etapa de **interpretação semântica** entre CNAEs e FTEs, especialmente quando a correspondência não é direta por código mas sim por descrição da atividade.

---

## 10. Limitações e Disclaimers

1. **CNAE não é determinante**: a correspondência CNAE × atividade ambiental é indicativa, não vinculante.
2. **FTEs são dinâmicas**: as Fichas Técnicas são atualizadas periodicamente pelo IBAMA.
3. **Áreas contaminadas não possuem API**: a consulta é necessariamente manual nos portais GIS.
4. **Habilitação municipal varia**: apenas ~14% dos municípios de SP estão habilitados para licenciamento.
5. **Não substitui parecer técnico**: o sistema é ferramenta de apoio, não de decisão final.
6. **Escopo SP**: os agentes 3, 4 e 5 são específicos para o Estado de São Paulo. Para outros estados, adaptar legislação e órgãos.
