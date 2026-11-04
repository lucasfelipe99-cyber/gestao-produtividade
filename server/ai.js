// Resumo de anotações com IA (API da Anthropic / Claude)
// Configuração por variáveis de ambiente:
//   ANTHROPIC_API_KEY  chave da API (obrigatória para habilitar)
//   AI_MODEL           modelo (padrão: claude-haiku-5-5, rápido e barato)
//   AI_BASE_URL        opcional, para testes

const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODEL = () => process.env.AI_MODEL || 'claude-haiku-5-5';
const BASE = () => (process.env.AI_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

export const aiEnabled = () => !!KEY();

const SYSTEM = `Você organiza o bloco de notas diário de um colaborador de uma equipe de e-commerce (marketplaces como Mercado Livre, Shopee, TikTok Shop e Magalu).
Leia as anotações soltas e devolva um resumo organizado, fiel ao que foi escrito.
Regras:
- Use somente o que está nas anotações. Não invente fatos, números, nomes ou conclusões.
- Escreva em português do Brasil, frases curtas e objetivas.
- Preserve números, valores, percentuais, códigos e nomes exatamente como aparecem.
- Agrupe por empresa/cliente e por canal quando o texto permitir identificar.
- Se algo não se encaixar, coloque em "outros".
- Responda APENAS com um JSON válido, sem texto antes ou depois, neste formato:
{"resumo":"2 a 4 frases com o panorama do dia",
 "por_empresa":[{"empresa":"nome ou 'Geral'","canal":"canal ou ''","itens":["..."]}],
 "feito":["o que foi concluído"],
 "pendencias":["o que ficou pendente ou precisa ser feito, com prazo se houver"],
 "problemas":["problemas, bloqueios ou riscos citados"],
 "dados":["números e métricas citados, com contexto"],
 "outros":["o que não se encaixa acima"]}
Listas vazias quando não houver conteúdo.`;

function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA não devolveu um resumo no formato esperado');
  const obj = JSON.parse(text.slice(start, end + 1));
  const arr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean).slice(0, 60) : []);
  return {
    resumo: typeof obj.resumo === 'string' ? obj.resumo : '',
    por_empresa: Array.isArray(obj.por_empresa)
      ? obj.por_empresa.map((g) => ({ empresa: String(g?.empresa || 'Geral'), canal: String(g?.canal || ''), itens: arr(g?.itens) })).filter((g) => g.itens.length).slice(0, 20)
      : [],
    feito: arr(obj.feito), pendencias: arr(obj.pendencias), problemas: arr(obj.problemas), dados: arr(obj.dados), outros: arr(obj.outros),
  };
}

export async function summarizeNotes({ content, personName, day, businesses = [], channels = [] }) {
  if (!aiEnabled()) throw new Error('IA não configurada: defina ANTHROPIC_API_KEY no servidor');
  const text = String(content || '').trim();
  if (!text) throw new Error('O bloco de notas está vazio');
  const user = `Colaborador: ${personName}\nData: ${day}\n` +
    (businesses.length ? `Empresas atendidas: ${businesses.join(', ')}\n` : '') +
    (channels.length ? `Canais: ${channels.join(', ')}\n` : '') +
    `\nAnotações do dia:\n"""\n${text.slice(0, 60000)}\n"""`;
  const res = await fetch(`${BASE()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Falha na IA (${res.status}): ${data?.error?.message || 'erro desconhecido'}`);
  const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return { ...parseJson(out), model: data.model || MODEL() };
}
