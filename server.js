const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURAÇÕES - TROCA AQUI
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const NUMERO_WHATSAPP_JM = "244949321312"; // TROCA PELO SEU NUMERO

// 2. ROTAS PÚBLICAS
app.get('/api/produtos', async (req, res) => {
  try {
    console.log("Tentando buscar produtos..."); // log pra ver se a rota é chamada
    console.log("URL:", process.env.SUPABASE_URL); // log pra ver se a env veio
    
    const { data, error } = await supabase.from('produtos').select('*');
    
    if (error) {
      console.error("ERRO SUPABASE:", error); // isso vai pro log do Render
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data);
  } catch (err) {
    console.error("ERRO GERAL:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cadastro', async (req, res) => {
  const { nome, email, senha, telefone } = req.body;
  const hash = await bcrypt.hash(senha, 10);
  const { error } = await supabase.from('usuarios').insert([{ nome, email, senha: hash, telefone }]);
  if(error) return res.status(400).json({error: "Email já cadastrado"});
  res.json({msg: "Usuário criado"});
});

app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  const { data } = await supabase.from('usuarios').select('*').eq('email', email).single();
  if(data && await bcrypt.compare(senha, data.senha)){
    res.json({msg: "Logado", user: {id: data.id, nome: data.nome}});
  } else {
    res.status(401).json({error: "Email ou senha inválidos"});
  }
});

// 3. ROTAS CARRINHO E PEDIDO
app.post('/api/checkout', async (req, res) => {
  const { usuario_id, itens } = req.body;
  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  
  const { data: pedido } = await supabase.from('pedidos').insert([{ usuario_id, total, forma_pagamento: 'whatsapp' }]).select().single();
  
  const itensParaSalvar = itens.map(i => ({pedido_id: pedido.id, produto_id: i.id, quantidade: i.quantidade, preco_unitario: i.preco}));
  await supabase.from('itens_pedido').insert(itensParaSalvar);

  // MENSAGEM WHATSAPP
  let msg = `*NOVO PEDIDO JM #${pedido.id}*\n\n`;
  itens.forEach(i => msg += `- ${i.nome} x${i.quantidade}: ${i.preco.toLocaleString('pt-AO')} KZ\n`);
  msg += `\n*Total: ${total.toLocaleString('pt-AO')} KZ*`;
  const link = `https://wa.me/${NUMERO_WHATSAPP_JM}?text=${encodeURIComponent(msg)}`;
  res.json({link, pedido_id: pedido.id});
});

// 4. ROTAS ADMIN
app.get('/api/admin/pedidos', async (req, res) => {
  const { data } = await supabase.from('pedidos').select('*, usuarios(nome, telefone)').order('id', { ascending: false });
  res.json(data);
});

app.put('/api/admin/pedido/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  await supabase.from('pedidos').update({ status }).eq('id', id);
  res.json({msg: "Atualizado"});
});

// 5. ROTA WEBHOOK - JÁ PRONTA PRA MULTICAIXA
app.post('/api/webhook', async (req, res) => {
  const { pedido_id, status } = req.body; 
  if(status === 'pago'){
    await supabase.from('pedidos').update({ status: 'Pago' }).eq('id', pedido_id);
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JM Server rodando na ${PORT}`));
