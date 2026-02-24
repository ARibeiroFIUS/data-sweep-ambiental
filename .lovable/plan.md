

# Supply Risk Mapping — Plano de Implementação

## Visão Geral
Sistema SaaS de análise de risco de fornecedores que consulta automaticamente bases de dados públicas brasileiras a partir de um CNPJ, calcula um score de risco e exibe um relatório visual completo no estilo dark/moderno do exemplo fornecido.

## Fase 1 — MVP (Escopo Inicial)

### 1. Tela de Consulta
- Campo de entrada de CNPJ com máscara e validação
- Botão "Analisar Risco" que dispara todas as consultas
- Loading state com indicação de progresso (quais bases estão sendo consultadas)

### 2. Backend (Supabase Edge Functions)
Uma edge function central que recebe o CNPJ e consulta em paralelo todas as APIs públicas disponíveis:
- **Receita Federal** — Dados cadastrais, situação, QSA, CNAE, endereço (via BrasilAPI ou ReceitaWS)
- **CEIS** — Cadastro de Empresas Inidôneas e Suspensas (API CGU)
- **CNEP** — Cadastro Nacional de Empresas Punidas (API CGU)
- **CEPIM** — Cadastro de Entidades Privadas Sem Fins Lucrativos Impedidas (API CGU)
- **Servidores Federais** — Verificação de sócios no Portal da Transparência (API CGU)
- **LICITANTES INIDÔNEOS (TCU)** — Lista do Tribunal de Contas da União
- **Trabalho Escravo (MTE)** — Lista suja (se disponível via API)
- **PGFN / Dívida Ativa** — Consulta de débitos com a União

### 3. Motor de Score de Risco
- Cálculo automático de score 0-100 baseado nas flags encontradas
- Cada flag tem um peso pré-definido (ex: CEIS = +35pts, servidor público = +25pts)
- Classificação final: Baixo / Médio / Alto / Crítico
- Resumo textual automático com recomendação

### 4. Relatório Visual (Dashboard)
Reproduzir fielmente o design dark/moderno do exemplo HTML:
- **Header** com nome da empresa e badge de risco colorido
- **Score circular** com cor dinâmica (verde/amarelo/laranja/vermelho)
- **Grid de informações** — Razão Social, CNPJ, Situação, Data Abertura, CNAE, Localização
- **Quadro Societário** — Tabela com nome, tipo (PF/PJ), qualificação e documento
- **Flags de Risco** — Cards coloridos por severidade com ícone, título, descrição e peso
- **Bases Consultadas** — Lista de todas as bases com status (consultado/indisponível)
- **Disclaimer** legal no rodapé

### 5. Design & UX
- Tema dark com as cores do exemplo (azul escuro, teal, laranja, fundo #0A0F1C)
- Font Outfit
- Cards com glassmorphism sutil (fundo semi-transparente + borda suave)
- Responsivo para desktop e tablet
- Animações sutis no carregamento dos resultados

## Fase 2 — Evolução Futura (não implementado agora)
- Autenticação e login de usuários
- Histórico de consultas salvas
- Exportação para PDF/HTML
- Dashboard com estatísticas (total de consultas, distribuição de risco)
- Consultas em lote (upload de planilha com múltiplos CNPJs)
- Planos e cobrança (Stripe)

