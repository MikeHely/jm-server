const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
require('dotenv').config(); // não esquece disso no Render
const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const NUMERO_WHATSAPP_JM = "244949321312";

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
  const { error } = await supabase.from('usuarios').insert([{ email, senha: hash }]);
  if(error) return res.status(400).json({error: "Email já cadastrado"});
  res.json({msg: "Usuário criado"});
});

app.post('/api/login', async (req, res) => {
  const { email, senha, password } = req.body;
  const pass = senha || password;
  const { data } = await supabase.from('usuarios').select('*').eq('email', email).single();
  if(!data) return res.status(401).json({error: "Email ou senha inválidos"});
  const senhaCorreta = await bcrypt.compare(pass, data.senha);
  if(senhaCorreta) res.json({msg: "Logado", user: {id: data.id, email: data.email}});
  else res.status(401).json({error: "Email ou senha inválidos"});
});

app.post('/api/admin/produtos', async (req, res) => {
  const { data, error } = await supabase.from('produtos').insert([req.body]).select();
  if(error) return res.status(500).json({error});
  res.json(data[0]);
});

app.put('/api/admin/produtos/:id', async (req, res) => {
  const { data, error } = await supabase.from('produtos').update(req.body).eq('id', req.params.id).select();
  if(error) return res.status(500).json({error});
  res.json(data[0]);
});

app.delete('/api/admin/produtos/:id', async (req, res) => {
  const { error } = await supabase.from('produtos').delete().eq('id', req.params.id);
  if(error) return res.status(500).json({error});
  res.json({msg: "Deletado"});
});

app.post('/api/checkout', async (req, res) => {
  const { usuario_id, itens } = req.body;
  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const { data: pedido } = await supabase.from('pedidos').insert([{ usuario_id, total, status: 'Pendente' }]).select().single();
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