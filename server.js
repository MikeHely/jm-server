const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // não esquece disso no Render
const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const NUMERO_WHATSAPP_JM = "244949321312";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("ERRO: falta configurar JWT_SECRET nas variáveis de ambiente!");
  process.exit(1);
}

// ===== MIDDLEWARES DE AUTENTICAÇÃO =====

// Verifica se veio um token válido no header Authorization: Bearer <token>
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload; // { id, email, is_admin }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// Usar SEMPRE depois de verificarToken
function verificarAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.is_admin) {
    return res.status(403).json({ error: "Acesso negado: apenas administradores" });
  }
  next();
}

// ===== ROTAS PÚBLICAS =====

app.get('/api/produtos', async (req, res) => {
  let { data, error } = await supabase.from('produtos').select('*').order('id');
  if(error) return res.status(500).json({error});
  res.json(data);
});

app.post('/api/register', async (req, res) => {
  const { email, password, senha } = req.body;
  const pass = password || senha;
  if(!pass) return res.status(400).json({error: "Senha obrigatória"});
  const hash = await bcrypt.hash(pass, 10);
  const { error } = await supabase.from('usuarios').insert([{ email, senha: hash, is_admin: false }]);
  if(error) return res.status(400).json({error: "Email já cadastrado"});
  res.json({msg: "Usuário criado"});
});

app.post('/api/login', async (req, res) => {
  const { email, senha, password } = req.body;
  const pass = senha || password;
  const { data } = await supabase.from('usuarios').select('*').eq('email', email).single();
  if(!data) return res.status(401).json({error: "Email ou senha inválidos"});
  const senhaCorreta = await bcrypt.compare(pass, data.senha);
  if(!senhaCorreta) return res.status(401).json({error: "Email ou senha inválidos"});

  const usuario = { id: data.id, email: data.email, is_admin: !!data.is_admin };
  const token = jwt.sign(usuario, JWT_SECRET, { expiresIn: '7d' });

  res.json({ msg: "Logado", user: usuario, token });
});

// ===== ROTAS DE ADMIN (protegidas) =====

app.post('/api/admin/produtos', verificarToken, verificarAdmin, async (req, res) => {
  const { data, error } = await supabase.from('produtos').insert([req.body]).select();
  if(error) return res.status(500).json({error});
  res.json(data[0]);
});

app.put('/api/admin/produtos/:id', verificarToken, verificarAdmin, async (req, res) => {
  const { data, error } = await supabase.from('produtos').update(req.body).eq('id', req.params.id).select();
  if(error) return res.status(500).json({error});
  res.json(data[0]);
});

app.delete('/api/admin/produtos/:id', verificarToken, verificarAdmin, async (req, res) => {
  const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
  if(error) return res.status(500).json({error});
  res.json({msg: "Deletado"});
});

// ===== CHECKOUT (protegido - precisa de login, mas não precisa ser admin) =====

app.post('/api/checkout', verificarToken, async (req, res) => {
  const usuario_id = req.usuario.id; // vem do token, não do body (evita spoofing)
  const { itens } = req.body;
  if (!itens || itens.length === 0) return res.status(400).json({ error: "Carrinho vazio" });

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const { data: pedido, error: erroPedido } = await supabase.from('pedidos').insert([{ usuario_id, total, status: 'Pendente' }]).select().single();
  if (erroPedido) return res.status(500).json({ error: erroPedido });

  const itensParaSalvar = itens.map(i => ({pedido_id: pedido.id, produto_id: i.id, quantidade: i.quantidade, preco_unitario: i.preco}));
  await supabase.from('itens_pedido').insert(itensParaSalvar);

  let msg = `*NOVO PEDIDO JM #${pedido.id}*\n\n`;
  itens.forEach(i => msg += `- ${i.nome} x${i.quantidade}: ${i.preco.toLocaleString('pt-PT')} KZ\n`);
  msg += `\n*Total: ${total.toLocaleString('pt-PT')} KZ*`;
  const link = `https://wa.me/${NUMERO_WHATSAPP_JM}?text=${encodeURIComponent(msg)}`;
  res.json({link, pedido_id: pedido.id});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JM Server rodando na ${PORT}`));
