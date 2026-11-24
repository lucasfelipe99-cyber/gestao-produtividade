// Central de anúncios: cliente → marketplace → conta → anúncio
// Tudo aqui usa tabelas novas (ads, mkt_accounts, sku_info…). A estrutura antiga (tarefas em grupo) não é alterada.
import ExcelJS from 'exceljs';
import { one, many, q, tx, broadcast } from './db.js';

export const CHECK_KEYS = ['anuncio', 'capa', 'ambientada', 'beneficios', 'objecao', 'como_usar', 'extra', 'video', 'ads', 'afiliados', 'promocao', 'cupom', 'relampago'];
export const DEFAULT_WEIGHTS = { anuncio: 5, capa: 15, ambientada: 10, beneficios: 8, objecao: 5, como_usar: 5, extra: 4, video: 8, ads: 10, afiliados: 10, promocao: 7, cupom: 7, relampago: 6 };
const CLASSES = ['alta', 'estrategico', 'geral'];

// código do anúncio a partir do link (ou o próprio texto, se já for o código)
export function adCodeFrom(value) {
  const t = String(value ?? '').trim();
  if (!t) return null;
  let m;
  if ((m = /MLB[-_ ]?(\d{6,})/i.exec(t))) return `MLB${m[1]}`;
  if ((m = /MLBU[-_ ]?(\d{4,})/i.exec(t))) return `MLBU${m[1]}`;
  if (/^https?:\/\//i.test(t)) {
    if ((m = /shopee[^/]*\/.*?[-.]i\.(\d+)\.(\d+)/i.exec(t)) || (m = /shopee[^/]*\/product\/(\d+)\/(\d+)/i.exec(t))) return m[2];
    if ((m = /amazon\.[^/]+\/(?:.*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(t))) return m[1].toUpperCase();
    if ((m = /tiktok[^/]*\/.*?(?:product|view\/product)\/(\d{6,})/i.exec(t))) return m[1];
    if ((m = /magazineluiza\.com\.br\/.*\/p\/([a-z0-9]+)/i.exec(t))) return m[1];
    if ((m = /shein\.com[^?]*-p-(\d+)/i.exec(t))) return m[1];
    if ((m = /temu\.com[^?]*-g-(\d+)/i.exec(t))) return m[1];
    return null;
  }
  return t.replace(/\.0+$/, '').slice(0, 120);
}
const normCode = (c) => (c ? String(c).trim().toUpperCase().replace(/^MLB[-_ ]/, 'MLB') : null);
const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isAdmin = (u) => u.role === 'admin';
const txt = (v, n = 2000) => { const t = String(v ?? '').trim(); return t ? t.slice(0, n) : null; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

// --------------------------------------------------------------------------------------------
// MIGRAÇÃO (uma vez): copia os SKUs/anúncios da "Gestão de SKU" para a estrutura nova
// --------------------------------------------------------------------------------------------
export async function migrateToAds() {
  if (await one("SELECT 1 AS x FROM app_meta WHERE key='v30_migracao_anuncios'")) return;
  const size = await one('SELECT pg_size_pretty(pg_database_size(current_database())) AS s');
  console.log('[v30] Banco antes da migração:', size.s);
  const before = await one(`SELECT count(DISTINCT i.id)::int AS skus,
      COALESCE(sum(jsonb_array_length(i.listings)),0)::int AS anuncios,
      (SELECT count(*)::int FROM group_items i2 JOIN group_tasks g2 ON g2.id=i2.group_id, jsonb_array_elements(i2.listings) l, jsonb_each(COALESCE(l->'checks','{}'::jsonb)) c
        WHERE g2.fixed AND g2.business_id IS NOT NULL) AS marcacoes
    FROM group_items i JOIN group_tasks g ON g.id=i.group_id WHERE g.fixed AND g.business_id IS NOT NULL`);
  console.log('[v30] Origem (Gestão de SKU):', JSON.stringify(before));
  const result = await tx(async (db) => {
    // 1) cópia de segurança de TODAS as tabelas, num esquema separado
    await db.query('CREATE SCHEMA IF NOT EXISTS backup_v30');
    const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'backup\\_%' ORDER BY 1`)).rows.map((r) => r.tablename);
    for (const t of tables) await db.query(`CREATE TABLE IF NOT EXISTS backup_v30."${t}" AS TABLE public."${t}"`);
    // 2) contas "Conta principal" + anúncios + SKUs
    const items = (await db.query(`SELECT i.*, g.business_id, g.company_id, g.id AS gid FROM group_items i JOIN group_tasks g ON g.id=i.group_id
      WHERE g.fixed AND g.business_id IS NOT NULL ORDER BY g.id, i.position, i.id`)).rows;
    const acc = new Map();
    const accountFor = async (companyId, businessId, channelId) => {
      const k = `${businessId}:${channelId}`;
      if (acc.has(k)) return acc.get(k);
      let r = (await db.query(`SELECT id FROM mkt_accounts WHERE business_id=$1 AND channel_id=$2 ORDER BY position, id LIMIT 1`, [businessId, channelId])).rows[0];
      if (!r) r = (await db.query(`INSERT INTO mkt_accounts (company_id, business_id, channel_id, name) VALUES ($1,$2,$3,'Conta principal') RETURNING id`, [companyId, businessId, channelId])).rows[0];
      acc.set(k, r.id); return r.id;
    };
    const ownerVotes = new Map();
    const okDate = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? v : null);
    const chans = (await db.query('SELECT id, company_id, name FROM channels')).rows;
    const HOSTS = [[/mercadoli[vb]re|mlb-?\d/i, /mercado ?livre/i], [/shopee/i, /shopee/i], [/tiktok/i, /tiktok/i], [/magazineluiza|magalu/i, /magalu|magazine/i],
      [/amazon/i, /amazon/i], [/shein/i, /shein/i], [/americanas/i, /americanas/i], [/temu/i, /temu/i]];
    const channelFor = async (companyId, l) => {
      const c = parseInt(l.channel_id, 10);
      if (c && chans.some((x) => x.id === c)) return c;
      const hit = HOSTS.find(([re]) => re.test(`${l.link || ''} ${l.code || ''}`));
      const byHost = hit && chans.find((x) => x.company_id === companyId && hit[1].test(x.name));
      if (byHost) return byHost.id;
      let other = chans.find((x) => x.company_id === companyId && x.name === 'Sem marketplace');
      if (!other) { other = (await db.query(`INSERT INTO channels (company_id, name, color) VALUES ($1,'Sem marketplace','#9aa0b4') RETURNING id, company_id, name`, [companyId])).rows[0]; chans.push(other); }
      return other.id;
    };
    let ads = 0, marks = 0, skus = 0;
    for (const i of items) {
      const sku = txt(i.sku, 120) || `#${i.id}`;
      const ins = await db.query(`INSERT INTO sku_info (company_id, business_id, sku, description, drive_link, drive_by, drive_at, checks, legacy, created_by, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (business_id, lower(sku)) DO NOTHING RETURNING id`,
        [i.company_id, i.business_id, sku, i.description, i.drive_link, i.drive_by, i.drive_at, JSON.stringify(i.checks || {}),
          JSON.stringify({ group_id: i.gid, item_ids: [i.id], curva: i.curva, faturamento: i.faturamento, abc: i.abc, roles: i.roles, assignee_id: i.assignee_id }), i.created_by, i.created_at]);
      if (ins.rowCount) skus++;
      else await db.query(`UPDATE sku_info SET drive_link=COALESCE(drive_link,$3), description=COALESCE(description,$4),
          checks = $5::jsonb || checks, legacy = jsonb_set(legacy, '{item_ids}', (legacy->'item_ids') || to_jsonb($6::int))
        WHERE business_id=$1 AND lower(sku)=lower($2)`, [i.business_id, sku, i.drive_link, i.description, JSON.stringify(i.checks || {}), i.id]);
      const roles = i.roles || {};
      const resp = roles.performance || roles.anunciado || i.assignee_id || null;
      for (const l of Array.isArray(i.listings) ? i.listings : []) {
        const channelId = await channelFor(i.company_id, l);
        const accountId = await accountFor(i.company_id, i.business_id, channelId);
        const checks = {};
        for (const [k, v] of Object.entries(l.checks || {})) { checks[k] = { s: 'ok', by: v?.by ?? null, name: v?.name ?? null, at: okDate(v?.at) }; marks++; }
        await db.query(`INSERT INTO ads (company_id, business_id, channel_id, account_id, ad_code, link, sku, title, checks, responsible_id, legacy,
            created_by, created_at, link_by, link_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())`,
          [i.company_id, i.business_id, channelId, accountId, normCode(l.code) || adCodeFrom(l.link), l.link || null, txt(i.sku, 120), i.description,
            JSON.stringify(checks), resp, JSON.stringify({ group_id: i.gid, item_id: i.id, listing_id: l.id, curva: i.curva, faturamento: i.faturamento, roles }),
            l.by || i.created_by, okDate(l.at) || i.created_at, (l.link || l.code) ? (l.link_by || l.by || null) : null, (l.link || l.code) ? (okDate(l.link_at) || okDate(l.at) || null) : null]);
        ads++;
        if (roles.estrategico) {
          const k = `${i.company_id}:${i.business_id}:${channelId}`;
          const m = ownerVotes.get(k) || new Map(); m.set(roles.estrategico, (m.get(roles.estrategico) || 0) + 1); ownerVotes.set(k, m);
        }
      }
    }
    // 3) responsável estratégico por cliente/marketplace = quem mais tinha a função "Estratégico" ali
    for (const [k, m] of ownerVotes) {
      const [companyId, businessId, channelId] = k.split(':').map(Number);
      const uid = [...m].sort((a, b) => b[1] - a[1])[0][0];
      await db.query(`INSERT INTO client_channel_owners (business_id, channel_id, company_id, user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [businessId, channelId, companyId, uid]);
    }
    // 4) conferência: tem que bater exatamente com a origem, senão desfaz tudo
    const after = (await db.query(`SELECT count(*)::int AS anuncios, (SELECT count(*)::int FROM ads a2, jsonb_each(a2.checks)) AS marcacoes FROM ads`)).rows[0];
    if (after.anuncios !== before.anuncios || after.marcacoes !== before.marcacoes || ads !== before.anuncios || marks !== before.marcacoes) {
      throw new Error(`Conferência falhou: origem ${JSON.stringify(before)} x destino ${JSON.stringify(after)}`);
    }
    await db.query("INSERT INTO app_meta (key) VALUES ('v30_migracao_anuncios')");
    return { tabelas_copiadas: tables.length, skus_origem: before.skus, skus_novos: skus, anuncios: after.anuncios, marcacoes: after.marcacoes, contas: acc.size, responsaveis_estrategicos: ownerVotes.size };
  });
  console.log('[v30] Migração concluída e conferida:', JSON.stringify(result));
}

// --------------------------------------------------------------------------------------------
// ROTAS
// --------------------------------------------------------------------------------------------
export function registerAds(app, { requireTab }) {
  const T = requireTab('anuncios');
  const ready = async () => !!(await one("SELECT 1 AS x FROM app_meta WHERE key='v30_migracao_anuncios'"));
  const assertBiz = async (db, u, businessId) => {
    if (!businessId || !(await db.query('SELECT 1 FROM businesses WHERE id=$1 AND company_id=$2', [businessId, u.company_id])).rowCount) throw new HttpError(400, 'Cliente inválido');
  };
  const assertChannel = async (db, u, channelId) => {
    if (!channelId || !(await db.query('SELECT 1 FROM channels WHERE id=$1 AND company_id=$2', [channelId, u.company_id])).rowCount) throw new HttpError(400, 'Marketplace inválido');
  };
  const assertUser = async (db, u, userId) => {
    if (userId && !(await db.query('SELECT 1 FROM users WHERE id=$1 AND company_id=$2', [userId, u.company_id])).rowCount) throw new HttpError(400, 'Colaborador inválido');
  };
  const accountOf = async (db, u, accountId) => {
    const a = (await db.query('SELECT * FROM mkt_accounts WHERE id=$1 AND company_id=$2', [accountId, u.company_id])).rows[0];
    if (!a) throw new HttpError(400, 'Conta inválida');
    return a;
  };
  const mainAccount = async (db, u, businessId, channelId) => {
    let a = (await db.query('SELECT * FROM mkt_accounts WHERE business_id=$1 AND channel_id=$2 AND active ORDER BY position, id LIMIT 1', [businessId, channelId])).rows[0];
    if (!a) a = (await db.query(`INSERT INTO mkt_accounts (company_id, business_id, channel_id, name) VALUES ($1,$2,$3,'Conta principal') RETURNING *`, [u.company_id, businessId, channelId])).rows[0];
    return a;
  };
  const AD_COLS = `a.id, a.business_id, a.channel_id, a.account_id, a.ad_code, a.link, a.sku, a.title, a.classification, a.checks, a.responsible_id,
    a.notes, a.extra, a.created_at, a.updated_at, a.updated_by, a.legacy->>'curva' AS legacy_curva`;

  // tudo que a planilha precisa
  app.get('/api/ads', T, wrap(async (req, res) => {
    const u = req.user;
    const biz = int(req.query.business_id);
    const p = [u.company_id]; let w = '';
    if (biz) { p.push(biz); w = ` AND a.business_id=$2`; }
    const [ads, accounts, owners, config, skus] = await Promise.all([
      many(`SELECT ${AD_COLS} FROM ads a WHERE a.company_id=$1 AND NOT a.archived${w} ORDER BY a.business_id, a.channel_id, a.sku NULLS LAST, a.id`, p),
      many(`SELECT id, business_id, channel_id, name, active, position FROM mkt_accounts WHERE company_id=$1 ORDER BY business_id, channel_id, position, id`, [u.company_id]),
      many(`SELECT business_id, channel_id, user_id FROM client_channel_owners WHERE company_id=$1`, [u.company_id]),
      many(`SELECT channel_id, classification, weights FROM score_config WHERE company_id=$1`, [u.company_id]),
      many(`SELECT business_id, sku, drive_link, checks FROM sku_info WHERE company_id=$1${biz ? ' AND business_id=$2' : ''}`, p),
    ]);
    res.json({ ready: await ready(), ads, accounts, owners, config, skus, default_weights: DEFAULT_WEIGHTS, keys: CHECK_KEYS });
  }));

  // novo anúncio manual
  app.post('/api/ads', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    const r = await tx(async (db) => {
      const businessId = int(b.business_id), channelId = int(b.channel_id);
      await assertBiz(db, u, businessId); await assertChannel(db, u, channelId);
      const a = b.account_id ? await accountOf(db, u, int(b.account_id)) : await mainAccount(db, u, businessId, channelId);
      if (a.business_id !== businessId || a.channel_id !== channelId) throw new HttpError(400, 'A conta não é deste cliente/marketplace');
      const raw = txt(b.ad, 2000);
      const code = adCodeFrom(raw), link = isUrl(raw) ? raw : null;
      if (code && (await db.query('SELECT 1 FROM ads WHERE account_id=$1 AND upper(ad_code)=upper($2) AND NOT archived', [a.id, code])).rowCount) throw new HttpError(400, `O anúncio ${code} já está cadastrado nesta conta`);
      const cls = CLASSES.includes(b.classification) ? b.classification : 'geral';
      const resp = int(b.responsible_id); await assertUser(db, u, resp);
      return (await db.query(`INSERT INTO ads (company_id, business_id, channel_id, account_id, ad_code, link, sku, title, classification, responsible_id, notes, created_by, link_by, link_at, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12) RETURNING id`,
        [u.company_id, businessId, channelId, a.id, code, link, txt(b.sku, 120), txt(b.title, 500), cls, resp, txt(b.notes, 2000), u.id, raw ? u.id : null, raw ? new Date() : null])).rows[0];
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json(r);
  }));

  // aplica uma alteração num anúncio (usado na edição de célula e em massa)
  async function applyChange(db, u, ad, b) {
    const set = []; const p = [ad.id];
    const put = (col, v) => { p.push(v); set.push(`${col}=$${p.length}`); };
    if ('ad' in b) {
      const raw = txt(b.ad, 2000);
      const code = adCodeFrom(raw);
      if (code && code !== ad.ad_code && (await db.query('SELECT 1 FROM ads WHERE account_id=$1 AND upper(ad_code)=upper($2) AND id<>$3 AND NOT archived', [ad.account_id, code, ad.id])).rowCount) throw new HttpError(400, `O anúncio ${code} já existe nesta conta`);
      put('ad_code', code); put('link', isUrl(raw) ? raw : (code === ad.ad_code ? ad.link : null));
      if (raw) { put('link_by', u.id); set.push('link_at=now()'); }
    }
    if ('sku' in b) put('sku', txt(b.sku, 120));
    if ('title' in b) put('title', txt(b.title, 500));
    if ('notes' in b) put('notes', txt(b.notes, 4000));
    if ('classification' in b) { if (!CLASSES.includes(b.classification)) throw new HttpError(400, 'Classificação inválida'); put('classification', b.classification); }
    if ('responsible_id' in b) { const r = int(b.responsible_id); await assertUser(db, u, r); put('responsible_id', r); }
    if ('account_id' in b) {
      const a = await accountOf(db, u, int(b.account_id));
      if (a.business_id !== ad.business_id || a.channel_id !== ad.channel_id) throw new HttpError(400, 'A conta precisa ser do mesmo cliente e marketplace');
      put('account_id', a.id);
    }
    if ('archived' in b) { if (!isAdmin(u)) throw new HttpError(403, 'Só administradores podem arquivar anúncios'); put('archived', !!b.archived); }
    if (b.check) {
      const key = b.check.key;
      if (!CHECK_KEYS.includes(key)) throw new HttpError(400, 'Item do checklist inválido');
      const st = b.check.state;
      if (st === 'ok' || st === 'na') { p.push(key, JSON.stringify({ s: st, by: u.id, name: u.name, at: new Date().toISOString() })); set.push(`checks = checks || jsonb_build_object($${p.length - 1}::text, $${p.length}::jsonb)`); }
      else { p.push(key); set.push(`checks = checks - $${p.length}::text`); }
    }
    if (!set.length) return;
    p.push(u.id);
    await db.query(`UPDATE ads SET ${set.join(', ')}, updated_by=$${p.length}, updated_at=now() WHERE id=$1`, p);
  }

  app.patch('/api/ads/:id', T, wrap(async (req, res) => {
    const u = req.user;
    const row = await tx(async (db) => {
      const ad = (await db.query('SELECT * FROM ads WHERE id=$1 AND company_id=$2 FOR UPDATE', [req.params.id, u.company_id])).rows[0];
      if (!ad) throw new HttpError(404, 'Anúncio não encontrado');
      await applyChange(db, u, ad, req.body || {});
      return (await db.query(`SELECT ${AD_COLS} FROM ads a WHERE a.id=$1`, [ad.id])).rows[0];
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json(row);
  }));

  // alterações em massa
  app.post('/api/ads/bulk', T, wrap(async (req, res) => {
    const u = req.user;
    const ids = [...new Set((req.body?.ids || []).map(int).filter(Boolean))].slice(0, 5000);
    if (!ids.length) throw new HttpError(400, 'Selecione os anúncios');
    const change = req.body?.change || {};
    const n = await tx(async (db) => {
      const ads = (await db.query('SELECT * FROM ads WHERE company_id=$1 AND id = ANY($2::int[]) FOR UPDATE', [u.company_id, ids])).rows;
      for (const ad of ads) await applyChange(db, u, ad, change);
      return ads.length;
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json({ updated: n });
  }));

  // contas por cliente/marketplace
  app.post('/api/mkt-accounts', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    if (!isAdmin(u)) throw new HttpError(403, 'Só administradores cadastram contas');
    const name = txt(b.name, 80); if (!name) throw new HttpError(400, 'Informe o nome da conta');
    const r = await tx(async (db) => {
      await assertBiz(db, u, int(b.business_id)); await assertChannel(db, u, int(b.channel_id));
      const pos = (await db.query('SELECT COALESCE(max(position),0)+1 AS p FROM mkt_accounts WHERE business_id=$1 AND channel_id=$2', [int(b.business_id), int(b.channel_id)])).rows[0].p;
      try {
        return (await db.query('INSERT INTO mkt_accounts (company_id, business_id, channel_id, name, position) VALUES ($1,$2,$3,$4,$5) RETURNING *', [u.company_id, int(b.business_id), int(b.channel_id), name, pos])).rows[0];
      } catch (e) { if (e.code === '23505') throw new HttpError(400, 'Já existe uma conta com esse nome'); throw e; }
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json(r);
  }));
  app.patch('/api/mkt-accounts/:id', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    if (!isAdmin(u)) throw new HttpError(403, 'Só administradores alteram contas');
    const a = await one('SELECT * FROM mkt_accounts WHERE id=$1 AND company_id=$2', [req.params.id, u.company_id]);
    if (!a) throw new HttpError(404, 'Conta não encontrada');
    const name = 'name' in b ? txt(b.name, 80) : a.name; if (!name) throw new HttpError(400, 'Informe o nome da conta');
    try { await q('UPDATE mkt_accounts SET name=$2, active=$3 WHERE id=$1', [a.id, name, 'active' in b ? !!b.active : a.active]); }
    catch (e) { if (e.code === '23505') throw new HttpError(400, 'Já existe uma conta com esse nome'); throw e; }
    broadcast(u.company_id, { type: 'ads' });
    res.json({ ok: true });
  }));
  app.put('/api/client-channel-owner', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    if (!isAdmin(u)) throw new HttpError(403, 'Só administradores definem o responsável estratégico');
    await tx(async (db) => {
      await assertBiz(db, u, int(b.business_id)); await assertChannel(db, u, int(b.channel_id)); await assertUser(db, u, int(b.user_id));
      await db.query(`INSERT INTO client_channel_owners (business_id, channel_id, company_id, user_id, updated_at) VALUES ($1,$2,$3,$4,now())
        ON CONFLICT (business_id, channel_id) DO UPDATE SET user_id=EXCLUDED.user_id, updated_at=now()`, [int(b.business_id), int(b.channel_id), u.company_id, int(b.user_id)]);
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json({ ok: true });
  }));

  // pesos da pontuação
  app.put('/api/score-config', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    if (!isAdmin(u)) throw new HttpError(403, 'Só administradores alteram os pesos');
    const ch = int(b.channel_id) || null, cls = CLASSES.includes(b.classification) ? b.classification : null;
    if (ch) await assertChannel({ query: q }, u, ch);
    if (b.reset) {
      if (!ch && !cls) await q('DELETE FROM score_config WHERE company_id=$1 AND channel_id IS NULL AND classification IS NULL', [u.company_id]);
      else await q('DELETE FROM score_config WHERE company_id=$1 AND COALESCE(channel_id,0)=$2 AND COALESCE(classification,\'\')=$3', [u.company_id, ch || 0, cls || '']);
    } else {
      const w = {};
      for (const k of CHECK_KEYS) { const v = Number(b.weights?.[k]); if (!Number.isFinite(v) || v < 0 || v > 100) throw new HttpError(400, 'Pesos devem ser números de 0 a 100'); w[k] = v; }
      if (!Object.values(w).some((v) => v > 0)) throw new HttpError(400, 'Defina ao menos um peso maior que zero');
      await q(`INSERT INTO score_config (company_id, channel_id, classification, weights, updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (company_id, COALESCE(channel_id, 0), COALESCE(classification, '')) DO UPDATE SET weights=EXCLUDED.weights, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [u.company_id, ch, cls, JSON.stringify(w), u.id]);
    }
    broadcast(u.company_id, { type: 'ads' });
    res.json({ ok: true });
  }));

  // ---------------- importação da base de anúncios ----------------
  const FIELDS = ['ad_code', 'link', 'sku', 'title', 'status', 'price', 'stock'];
  const GUESS = {
    ad_code: /^(#\s*)?(de\s+)?(id|codigo|cod|numero|n|#)\s*(do|de|da)?\s*(anuncio|item|produto|publicacao|listing)|^(item|listing|product|produto|anuncio)\s*id$|^mlb$|^asin$|^id$|^# de anuncio$/,
    link: /link|url|permalink/,
    sku: /^(sku|seller sku|sku do vendedor|sku de referencia|sku principal|codigo sku|parent sku|sku pai|referencia|cod\.? ?referencia)\b/,
    title: /^(titulo|nome do produto|nome|produto|title|product name|descricao do produto)\b/,
    status: /^(status|situacao|estado)\b/,
    price: /^(preco|price|valor)\b/,
    stock: /^(estoque|stock|quantidade disponivel|disponivel)\b/,
  };
  const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const cellVal = (v) => {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (v.hyperlink && !v.text) return String(v.hyperlink);
      return String(v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : v.hyperlink ?? '')).trim();
    }
    return String(v).trim();
  };
  const cellLink = (v) => (v && typeof v === 'object' && v.hyperlink ? String(v.hyperlink) : '');
  function parseCsv(text) {
    const first = text.split('\n')[0];
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cur = '', inq = false;
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (inq) { if (c === '"' && text[k + 1] === '"') { cur += '"'; k++; } else if (c === '"') inq = false; else cur += c; }
      else if (c === '"') inq = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[k + 1] === '\n') k++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.map((r) => r.map((c) => ({ v: c.trim(), h: '' })));
  }
  async function readFile(filename, data, sheetIdx = 0) {
    if (!data) throw new HttpError(400, 'Envie o arquivo');
    const buf = Buffer.from(String(data).replace(/^data:[^,]*,/, ''), 'base64');
    if (/\.(csv|txt|tsv)$/i.test(filename || '')) {
      let text = buf.toString('utf8').replace(/^﻿/, '');
      if (text.includes('�')) text = buf.toString('latin1');
      return { sheets: ['CSV'], rows: parseCsv(text) };
    }
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { throw new HttpError(400, 'Não consegui ler o arquivo. Envie em .xlsx ou .csv (arquivos .xls antigos: abra e salve como .xlsx)'); }
    const sheets = wb.worksheets.map((w) => w.name);
    const ws = wb.worksheets[Math.min(sheetIdx, wb.worksheets.length - 1)];
    if (!ws) throw new HttpError(400, 'O arquivo está vazio');
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const vals = [];
      for (let c = 1; c <= Math.max(r.cellCount, ws.columnCount || 0); c++) { const v = r.getCell(c).value; vals.push({ v: cellVal(v), h: cellLink(v) }); }
      rows[n - 1] = vals;
    });
    for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
    return { sheets, rows };
  }
  const guessHeaderRow = (rows) => {
    let best = 0, score = -1;
    for (let k = 0; k < Math.min(rows.length, 15); k++) {
      const cells = rows[k].map((c) => norm(c.v)).filter(Boolean);
      const s = cells.filter((c) => Object.values(GUESS).some((re) => re.test(c))).length * 3 + cells.length;
      if (s > score) { score = s; best = k; }
    }
    return best;
  };
  const guessMapping = (headers) => {
    const m = {};
    for (const f of FIELDS) { const idx = headers.findIndex((h, k) => GUESS[f].test(norm(h)) && !Object.values(m).includes(k)); if (idx >= 0) m[f] = idx; }
    return m;
  };
  async function analyse(db, u, body) {
    const accountId = int(body.account_id);
    const a = await accountOf(db, u, accountId);
    if (a.business_id !== int(body.business_id) || a.channel_id !== int(body.channel_id)) throw new HttpError(400, 'A conta não é deste cliente/marketplace');
    const { sheets, rows } = await readFile(body.filename, body.data, int(body.sheet) ? int(body.sheet) : 0);
    const saved = await one('SELECT header_row, mapping FROM import_mappings WHERE company_id=$1 AND channel_id=$2 AND kind=$3', [u.company_id, a.channel_id, 'anuncios']);
    const headerRow = Number.isInteger(body.header_row) ? body.header_row : saved ? saved.header_row : guessHeaderRow(rows);
    const headers = (rows[headerRow] || []).map((c) => c.v);
    let mapping = body.mapping;
    if (!mapping) {
      mapping = guessMapping(headers);
      if (saved?.mapping) for (const [f, name] of Object.entries(saved.mapping)) { const k = headers.findIndex((h) => norm(h) === norm(name)); if (k >= 0) mapping[f] = k; }
    }
    const out = { sheets, header_row: headerRow, headers, mapping, sample_rows: rows.slice(0, 12).map((r) => r.map((c) => c.v)), fields: FIELDS };
    if (!('ad_code' in mapping) && !('link' in mapping)) return { ...out, ready: false };
    const get = (r, f) => (f in mapping && mapping[f] !== null && mapping[f] !== '' ? r[mapping[f]] || { v: '', h: '' } : { v: '', h: '' });
    const existing = (await db.query('SELECT id, upper(ad_code) AS code, sku, title, link FROM ads WHERE account_id=$1 AND NOT archived AND ad_code IS NOT NULL', [a.id])).rows;
    const byCode = new Map(); const dupDb = new Set();
    for (const e of existing) { if (byCode.has(e.code)) dupDb.add(e.code); else byCode.set(e.code, e); }
    const seen = new Map(); const recs = []; let noId = 0; const dupFile = new Set();
    for (let k = headerRow + 1; k < rows.length; k++) {
      const r = rows[k];
      if (!r.some((c) => c.v)) continue;
      const codeCell = get(r, 'ad_code'), linkCell = get(r, 'link');
      const link = isUrl(linkCell.v) ? linkCell.v : isUrl(linkCell.h) ? linkCell.h : isUrl(codeCell.h) ? codeCell.h : null;
      const code = normCode(adCodeFrom(codeCell.v) || adCodeFrom(link));
      if (!code) { noId++; continue; }
      const rec = { line: k + 1, code, link, sku: txt(get(r, 'sku').v, 120), title: txt(get(r, 'title').v, 500),
        extra: Object.fromEntries(['status', 'price', 'stock'].map((f) => [f, txt(get(r, f).v, 120)]).filter(([, v]) => v)) };
      if (seen.has(code)) { dupFile.add(code); Object.assign(seen.get(code), Object.fromEntries(Object.entries(rec).filter(([, v]) => v))); continue; } // mesma linha repetida (variações): junta
      seen.set(code, rec); recs.push(rec);
    }
    let created = 0, updated = 0, same = 0;
    for (const r of recs) {
      const e = byCode.get(r.code);
      if (!e) { r.action = 'novo'; created++; }
      else if ((r.sku && r.sku !== e.sku) || (r.title && r.title !== e.title) || (r.link && r.link !== e.link) || Object.keys(r.extra).length) { r.action = 'atualizar'; r.id = e.id; updated++; }
      else { r.action = 'igual'; r.id = e.id; same++; }
    }
    const inFile = new Set(recs.map((r) => r.code));
    const notInFile = existing.filter((e) => !inFile.has(e.code)).length;
    return { ...out, ready: true, account: a, recs,
      counts: { linhas: recs.length, novos: created, atualizar: updated, iguais: same, sem_id: noId, repetidos_no_arquivo: dupFile.size, duplicados_no_sistema: dupDb.size, no_sistema_fora_do_arquivo: notInFile },
      preview: recs.slice(0, 30).map(({ line, code, sku, title, action }) => ({ line, code, sku, title, action })),
      dup_codes: [...dupFile].slice(0, 20) };
  }
  app.post('/api/ads/import/preview', T, wrap(async (req, res) => {
    const r = await tx((db) => analyse(db, req.user, req.body || {}));
    delete r.recs; delete r.account;
    res.json(r);
  }));
  app.post('/api/ads/import/apply', T, wrap(async (req, res) => {
    const u = req.user, b = req.body || {};
    const out = await tx(async (db) => {
      const r = await analyse(db, u, b);
      if (!r.ready) throw new HttpError(400, 'Relacione a coluna do ID do anúncio (ou do link)');
      const a = r.account;
      for (const x of r.recs) {
        if (x.action === 'novo') {
          await db.query(`INSERT INTO ads (company_id, business_id, channel_id, account_id, ad_code, link, sku, title, extra, created_by, updated_by, legacy)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,'{"import":true}'::jsonb)`, [u.company_id, a.business_id, a.channel_id, a.id, x.code, x.link, x.sku, x.title, JSON.stringify(x.extra), u.id]);
        } else if (x.action === 'atualizar') {
          // só completa/atualiza dados do arquivo; checklist, classificação, responsável e observações nunca são tocados
          await db.query(`UPDATE ads SET sku=COALESCE($2, sku), title=COALESCE($3, title), link=COALESCE($4, link), extra = extra || $5::jsonb, updated_at=now(), updated_by=$6 WHERE id=$1`,
            [x.id, x.sku, x.title, x.link, JSON.stringify(x.extra), u.id]);
        }
      }
      const headers = r.headers;
      const named = Object.fromEntries(Object.entries(r.mapping).filter(([, k]) => k !== '' && k != null).map(([f, k]) => [f, headers[k]]));
      await db.query(`INSERT INTO import_mappings (company_id, channel_id, kind, header_row, mapping) VALUES ($1,$2,'anuncios',$3,$4)
        ON CONFLICT (company_id, channel_id, kind) DO UPDATE SET header_row=EXCLUDED.header_row, mapping=EXCLUDED.mapping, updated_at=now()`, [u.company_id, a.channel_id, r.header_row, JSON.stringify(named)]);
      await db.query(`INSERT INTO ad_imports (company_id, kind, business_id, channel_id, account_id, filename, mapping, counts, user_id) VALUES ($1,'anuncios',$2,$3,$4,$5,$6,$7,$8)`,
        [u.company_id, a.business_id, a.channel_id, a.id, txt(b.filename, 200), JSON.stringify(named), JSON.stringify(r.counts), u.id]);
      return r.counts;
    });
    broadcast(u.company_id, { type: 'ads' });
    res.json(out);
  }));
  app.get('/api/ads/imports', T, wrap(async (req, res) => {
    res.json(await many(`SELECT i.id, i.kind, i.filename, i.counts, i.created_at, b.name AS business, c.name AS channel, a.name AS account, u.name AS user_name
      FROM ad_imports i LEFT JOIN businesses b ON b.id=i.business_id LEFT JOIN channels c ON c.id=i.channel_id LEFT JOIN mkt_accounts a ON a.id=i.account_id
      LEFT JOIN users u ON u.id=i.user_id WHERE i.company_id=$1 ORDER BY i.created_at DESC LIMIT 100`, [req.user.company_id]));
  }));

  // ---------------- volume de trabalho por pessoa (quem clicou / preencheu) ----------------
  app.get('/api/volume', requireTab('volume'), wrap(async (req, res) => {
    const u = req.user;
    const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isDate(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10);
    const to = isDate(req.query.to) && req.query.to >= from ? req.query.to : from;
    if ((new Date(to) - new Date(from)) / 864e5 > 370) throw new HttpError(400, 'Período muito longo (máx. 1 ano)');
    const only = isAdmin(u) ? int(req.query.user) : u.id;
    const p = [u.company_id, from, to, u.timezone || 'America/Sao_Paulo'];
    const inR = (col) => `(${col} AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`;
    const who = (col) => (only ? ` AND ${col}=${only}` : '');
    const ev = await many(`
      SELECT 'check' AS kind, c.key, (c.value->>'by')::int AS user_id, (c.value->>'at')::timestamptz AS at, a.business_id, a.channel_id, a.sku, a.ad_code, a.link
        FROM ads a CROSS JOIN LATERAL jsonb_each(a.checks) c
        WHERE a.company_id=$1 AND c.value->>'s'='ok' AND c.value->>'at' IS NOT NULL AND ${inR("(c.value->>'at')::timestamptz")} ${who("(c.value->>'by')::int")}
      UNION ALL
      SELECT 'listing', NULL, a.created_by, a.created_at, a.business_id, a.channel_id, a.sku, a.ad_code, a.link
        FROM ads a WHERE a.company_id=$1 AND a.created_by IS NOT NULL AND (a.legacy->>'import') IS NULL AND ${inR('a.created_at')} ${who('a.created_by')}
      UNION ALL
      SELECT 'link', NULL, a.link_by, a.link_at, a.business_id, a.channel_id, a.sku, a.ad_code, a.link
        FROM ads a WHERE a.company_id=$1 AND a.link_by IS NOT NULL AND a.link_at IS NOT NULL AND ${inR('a.link_at')} ${who('a.link_by')}
      UNION ALL
      SELECT 'base', c.key, (c.value->>'by')::int, (c.value->>'at')::timestamptz, s.business_id, NULL, s.sku, NULL, NULL
        FROM sku_info s CROSS JOIN LATERAL jsonb_each(s.checks) c
        WHERE s.company_id=$1 AND c.value->>'at' IS NOT NULL AND ${inR("(c.value->>'at')::timestamptz")} ${who("(c.value->>'by')::int")}
      UNION ALL
      SELECT 'drive', NULL, s.drive_by, s.drive_at, s.business_id, NULL, s.sku, NULL, NULL
        FROM sku_info s WHERE s.company_id=$1 AND s.drive_by IS NOT NULL AND ${inR('s.drive_at')} ${who('s.drive_by')}
      UNION ALL
      SELECT 'sku', NULL, s.created_by, s.created_at, s.business_id, NULL, s.sku, NULL, NULL
        FROM sku_info s WHERE s.company_id=$1 AND s.created_by IS NOT NULL AND ${inR('s.created_at')} ${who('s.created_by')}
      UNION ALL
      SELECT 'task', NULL, t.assignee_id, t.completed_at, t.business_id, t.channel_id, NULL, t.title, NULL
        FROM tasks t WHERE t.company_id=$1 AND t.status='done' AND t.completed_at IS NOT NULL AND ${inR('t.completed_at')} ${who('t.assignee_id')}
      UNION ALL
      SELECT 'note', NULL, n.user_id, n.created_at, n.business_id, n.channel_id, NULL, left(n.body, 140), NULL
        FROM notes n WHERE n.company_id=$1 AND n.kind='note' AND ${inR('n.created_at')} ${who('n.user_id')}
      ORDER BY at DESC`, p);
    res.json({ from, to, user: only, events: ev });
  }));

  // cópia completa dos dados (para guardar fora do sistema)
  app.get('/api/admin/backup', wrap(async (req, res) => {
    const u = req.user;
    if (!isAdmin(u)) throw new HttpError(403, 'Apenas administradores');
    const tables = (await many(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'backup\\_%' ORDER BY 1`)).map((r) => r.tablename);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="backup-gestao-${stamp}.json"`);
    res.write(`{"gerado_em":${JSON.stringify(new Date().toISOString())},"tabelas":{`);
    let first = true;
    for (const t of tables) {
      const hasCompany = (await one(`SELECT 1 AS x FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='company_id'`, [t]));
      const rows = t === 'companies' ? await many('SELECT * FROM companies WHERE id=$1', [u.company_id])
        : hasCompany ? await many(`SELECT * FROM "${t}" WHERE company_id=$1`, [u.company_id]) : await many(`SELECT * FROM "${t}"`);
      if (t === 'users') rows.forEach((r) => { delete r.password_hash; });
      res.write(`${first ? '' : ','}${JSON.stringify(t)}:${JSON.stringify(rows)}`);
      first = false;
    }
    res.end('}}');
  }));
}
