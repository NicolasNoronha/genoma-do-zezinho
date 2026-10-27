# Genoma do Zezinho — produção

## Arquitetura

- Frontend estático em `dist/`
- API Node.js serverless em `api/index.js`
- PostgreSQL no Supabase
- Hospedagem e funções na Vercel
- Pagamentos no Mercado Pago

## 1. Supabase

Crie o projeto e aplique `supabase/migrations/202610270001_initial_schema.sql`. Em **Connect**, copie a URI do **Transaction pooler** e salve na Vercel como `POSTGRES_URL`.

## 2. Variáveis da Vercel

Cadastre em Production, Preview e Development conforme necessário:

- `POSTGRES_URL`: conexão do Transaction pooler do Supabase.
- `ADMIN_PIN`: PIN privado do painel administrativo.
- `SESSION_SECRET`: segredo aleatório com no mínimo 32 caracteres.
- `MERCADO_PAGO_ACCESS_TOKEN`: Access Token da aplicação Mercado Pago.
- `MERCADO_PAGO_BACK_URL`: URL HTTPS de retorno para assinaturas.
- `MERCADO_PAGO_WEBHOOK_URL`: `https://SEU-DOMINIO/api?action=webhook`.
- `MERCADO_PAGO_WEBHOOK_SECRET`: assinatura secreta configurada no painel do Mercado Pago.

Nunca envie `.env`, tokens ou senhas ao Git.

## 3. Git e Vercel

Conecte o repositório à Vercel. O `vercel.json` publica `dist/` e disponibiliza a função `/api`.

Depois do primeiro deploy, confirme `https://SEU-DOMINIO/api?action=health` e atualize as URLs do Mercado Pago para o domínio definitivo.
