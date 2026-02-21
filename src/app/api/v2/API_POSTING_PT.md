# API Skatehive - Endpoints de Postagem

Endpoints autenticados para bots e aplicativos postarem conteúdo na Skatehive.

---

## Autenticação

Todos os endpoints de postagem requerem uma API key via Bearer token:

```bash
Authorization: Bearer <sua_api_key>
```

### Como Obter uma API Key

Entre em contato com a equipe Skatehive para solicitar uma API key para seu app/bot.

**Gerar uma nova key:**
```bash
openssl rand -hex 32
```

---

## Limites de Taxa (Rate Limits)

| Endpoint | Limite |
|----------|--------|
| `/api/v2/composeBlog` | 20 requisições/minuto |
| `/api/v2/postFeed` | 50 requisições/minuto |

Headers de rate limit incluídos nas respostas:
- `X-RateLimit-Remaining`: Requisições restantes na janela atual
- `X-RateLimit-Reset`: Timestamp Unix de quando o limite reseta

---

## Endpoints

### 1. POST `/api/v2/composeBlog`

Criar um post de blog completo com título, markdown e metadata.

**Corpo da Requisição:**

```typescript
{
  title: string;              // Obrigatório
  body: string;               // Obrigatório (markdown)
  thumbnail: string;          // Obrigatório (URL IPFS ou regular)
  tags?: string[];            // Opcional (padrão: ['hive-173115', 'skateboarding'])
  images?: string[];          // Opcional (URLs para metadata)
  beneficiaries?: Array<{     // Opcional
    account: string;
    weight: number;           // 1-10000 (0.01% - 100%)
  }>;
  author_override?: string;   // Opcional (requer permissão especial)
}
```

**Exemplo:**

```bash
curl -X POST https://api.skatehive.app/api/v2/composeBlog \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Meu Primeiro Post na Skatehive",
    "body": "## Olá Skatehive!\n\nEste é meu primeiro post via API.\n\n![](https://ipfs.skatehive.app/ipfs/Qm...)",
    "thumbnail": "https://ipfs.skatehive.app/ipfs/Qm...",
    "tags": ["skateboarding", "tutorial", "hive-173115"],
    "beneficiaries": [
      {
        "account": "skatehacker",
        "weight": 1000
      }
    ]
  }'
```

**Resposta (201 Created):**

```json
{
  "success": true,
  "data": {
    "author": "skateuser",
    "permlink": "meu-primeiro-post-na-skatehive-1708563242",
    "title": "Meu Primeiro Post na Skatehive",
    "url": "https://skatehive.app/post/skateuser/meu-primeiro-post-na-skatehive-1708563242",
    "hive_url": "https://peakd.com/@skateuser/meu-primeiro-post-na-skatehive-1708563242",
    "transaction_id": "abc123..."
  }
}
```

---

### 2. POST `/api/v2/postFeed`

Criar um snap/post curto no feed da Skatehive (tipo um tweet).

**Corpo da Requisição:**

```typescript
{
  body: string;               // Obrigatório
  images?: string[];          // Opcional (URLs IPFS ou regulares)
  video_url?: string;         // Opcional (hash IPFS ou URL 3Speak)
  parent_author?: string;     // Opcional (padrão: autor do thread)
  parent_permlink?: string;   // Opcional (padrão: snap-container mais recente)
  author_override?: string;   // Opcional (requer permissão especial)
}
```

**Exemplo:**

```bash
curl -X POST https://api.skatehive.app/api/v2/postFeed \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Consegui meu primeiro kickflip! 🛹 #skateboarding #progress",
    "images": [
      "https://ipfs.skatehive.app/ipfs/Qm..."
    ]
  }'
```

**Resposta (201 Created):**

```json
{
  "success": true,
  "data": {
    "author": "skateuser",
    "permlink": "550e8400-e29b-41d4-a716-446655440000",
    "parent_author": "skatehivethread",
    "parent_permlink": "snap-container-2026-02-21",
    "url": "https://skatehive.app/post/skateuser/550e8400-e29b-41d4-a716-446655440000",
    "hive_url": "https://peakd.com/@skateuser/550e8400-e29b-41d4-a716-446655440000",
    "transaction_id": "def456..."
  }
}
```

---

## Respostas de Erro

### 401 Unauthorized

```json
{
  "success": false,
  "error": "Invalid API key"
}
```

### 400 Bad Request

```json
{
  "success": false,
  "error": "Title is required"
}
```

### 429 Too Many Requests

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "resetAt": "2026-02-21T16:30:00.000Z"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Failed to post to blockchain",
  "details": "Mensagem de erro..."
}
```

---

## Melhores Práticas

### 1. URLs de Imagens/Vídeos

- Use URLs IPFS para conteúdo permanente: `https://ipfs.skatehive.app/ipfs/Qm...`
- Imagens são automaticamente adicionadas aos metadados do post
- Vídeos usam iframe do 3Speak

### 2. Hashtags

- No `postFeed`, hashtags são automaticamente extraídas do texto
- Use formato `#hashtag` no seu texto
- A tag da comunidade `hive-173115` é sempre adicionada automaticamente

### 3. Beneficiários

- Peso total não pode exceder 10000 (100%)
- Peso de 1000 = 10%
- Apenas suportado no endpoint `composeBlog`

### 4. Tratamento de Erros

- Sempre verifique o campo `success` na resposta
- Implemente exponential backoff para erros de rate limit
- Registre `transaction_id` para debug

---

## Código de Exemplo

### JavaScript/Node.js

```javascript
const SKATEHIVE_API_KEY = process.env.SKATEHIVE_API_KEY;

async function postarNaSkatehive(titulo, corpo, thumbnail) {
  const response = await fetch('https://api.skatehive.app/api/v2/composeBlog', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SKATEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: titulo,
      body: corpo,
      thumbnail,
      tags: ['skateboarding', 'hive-173115']
    })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  console.log('Post criado:', data.data.url);
  return data.data;
}

// Uso
postarNaSkatehive(
  'Minha Sessão de Skate',
  'Tive uma sessão incrível hoje!',
  'https://ipfs.skatehive.app/ipfs/Qm...'
).catch(console.error);
```

---

## Variáveis de Ambiente

Adicione ao `.env.local`:

```bash
# API Keys (pares key:nome separados por vírgula)
SKATEHIVE_API_KEYS="abc123:MeuBot,def456:MeuApp"

# Credenciais Hive para posting
SKATEHIVE_POSTING_KEY="5K..."
SKATEHIVE_ACCOUNT="skateuser"
```

---

## Notas de Segurança

1. **Nunca compartilhe sua API key publicamente**
2. Armazene API keys em variáveis de ambiente, não no código
3. Use apenas HTTPS
4. Implemente rate limiting no seu lado para evitar erros 429
5. Valide todos os inputs de usuário antes de postar

---

## Suporte

Para solicitar API keys ou reportar problemas:
- Discord: https://discord.gg/skatehive
- Email: dev@skatehive.app
- GitHub: https://github.com/sktbrd/skatehive-api
