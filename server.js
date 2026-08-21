const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// ============================================
// 🔥 CORS CORRETO - RESOLVE O PROBLEMA
// ============================================
app.use(cors({
  origin: [
    'https://jm-store.vercel.app',
    'https://jm-store.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://jm-server.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Responder a todas as requisições OPTIONS (preflight)
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));

// ============================================
// CONFIGURAÇÕES
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const NUMERO_WHATSAPP_JM = "244949321312";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("ERRO: falta configurar JWT_SECRET!");
  process.exit(1);
}

// ============================================
// ROTA DE TESTE (para verificar se o servidor está online)
// ============================================
app.get('/api/test', function(req, res) {
  res.json({ 
    status: 'online', 
    time: new Date().toISOString(),
    message: '🚀 JM Server está funcionando!',
    cors: '✅ Configurado corretamente'
  });
});

// Rota raiz - redireciona para /api/test
app.get('/', function(req, res) {
  res.json({ 
    message: 'JM Store API',
    endpoints: {
      test: '/api/test',
      produtos: '/api/produtos',
      login: '/api/login',
      register: '/api/register'
    }
  });
});

// ============================================
// PRODUTOS - ROTA PÚBLICA
// ============================================
app.get('/api/produtos', async function(req, res) {
  try {
    console.log('📦 Buscando produtos...');
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('visivel', true)
      .order('id');
    
    if (error) throw error;
    console.log('✅ Produtos carregados:', data ? data.length : 0);
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro ao buscar produtos:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CATEGORIAS
// ============================================
app.get('/api/categorias', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('categoria')
      .eq('visivel', true)
      .order('categoria');
    
    if (error) throw error;
    const categorias = [...new Set((data || []).map(p => p.categoria))];
    res.json(categorias);
  } catch (error) {
    console.error('❌ Erro categorias:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// FAQ
// ============================================
app.get('/api/faq', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('faq')
      .select('*')
      .eq('ativo', true)
      .order('ordem');
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro FAQ:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USUÁRIOS - REGISTRO
// ============================================
app.post('/api/register', async function(req, res) {
  try {
    const { email, password, nome, telefone, regiao } = req.body;
    const senha = password || req.body.senha;
    
    console.log('📝 Tentativa de cadastro:', email);
    
    if (!email || !senha || !nome || !telefone) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    }
    
    const { data: existing } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }
    
    const hash = await bcrypt.hash(senha, 10);
    
    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ 
        email, 
        senha: hash, 
        nome, 
        telefone, 
        regiao,
        is_admin: false,
        data_cadastro: new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    
    res.json({ 
      msg: "Usuário criado com sucesso!",
      user: { id: data[0].id, email, nome }
    });
  } catch (error) {
    console.error('❌ Erro registro:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USUÁRIOS - LOGIN
// ============================================
app.post('/api/login', async function(req, res) {
  try {
    const { email, senha } = req.body;
    
    console.log('🔐 Tentativa login:', email);
    
    if (!email || !senha) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !data) {
      console.log('❌ Usuário não encontrado:', email);
      return res.status(401).json({ error: "Email ou senha inválidos" });
    }
    
    const senhaCorreta = await bcrypt.compare(senha, data.senha);
    if (!senhaCorreta) {
      console.log('❌ Senha incorreta para:', email);
      return res.status(401).json({ error: "Email ou senha inválidos" });
    }
    
    const usuario = { 
      id: data.id, 
      email: data.email, 
      nome: data.nome,
      telefone: data.telefone,
      regiao: data.regiao,
      is_admin: !!data.is_admin 
    };
    
    const token = jwt.sign(usuario, JWT_SECRET, { expiresIn: '7d' });
    
    console.log('✅ Login bem-sucedido:', email);
    res.json({ 
      msg: "Login realizado com sucesso!", 
      user: usuario, 
      token 
    });
  } catch (error) {
    console.error('❌ Erro login:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// USUÁRIOS - PERFIL
// ============================================
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

app.get('/api/usuario/perfil', verificarToken, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, email, nome, telefone, regiao, is_admin, data_cadastro')
      .eq('id', req.usuario.id)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Erro perfil:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CARRINHO
// ============================================
app.post('/api/carrinho', verificarToken, async function(req, res) {
  try {
    const { itens } = req.body;
    const usuario_id = req.usuario.id;
    
    if (!itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: "Itens inválidos" });
    }
    
    await supabase
      .from('carrinho')
      .delete()
      .eq('usuario_id', usuario_id);
    
    if (itens.length > 0) {
      const itensParaSalvar = itens.map(item => ({
        usuario_id,
        produto_id: item.id,
        quantidade: item.quantidade
      }));
      
      const { error } = await supabase
        .from('carrinho')
        .insert(itensParaSalvar);
      
      if (error) throw error;
    }
    
    res.json({ msg: "Carrinho salvo com sucesso" });
  } catch (error) {
    console.error('❌ Erro carrinho:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/carrinho', verificarToken, async function(req, res) {
  try {
    const usuario_id = req.usuario.id;
    
    const { data, error } = await supabase
      .from('carrinho')
      .select('quantidade, produtos(*)')
      .eq('usuario_id', usuario_id);
    
    if (error) throw error;
    
    const itens = (data || []).map(item => ({
      ...item.produtos,
      quantidade: item.quantidade
    }));
    
    res.json(itens);
  } catch (error) {
    console.error('❌ Erro buscar carrinho:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WISHLIST
// ============================================
app.post('/api/wishlist', verificarToken, async function(req, res) {
  try {
    const { produto_id } = req.body;
    
    if (!produto_id) {
      return res.status(400).json({ error: 'Produto é obrigatório' });
    }
    
    const { data, error } = await supabase
      .from('wishlist')
      .insert([{
        usuario_id: req.usuario.id,
        produto_id
      }])
      .select();
    
    if (error) throw error;
    res.json({ msg: 'Adicionado à wishlist', data: data[0] });
  } catch (error) {
    console.error('❌ Erro wishlist:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/wishlist/:produto_id', verificarToken, async function(req, res) {
  try {
    const { error } = await supabase
      .from('wishlist')
      .delete()
      .eq('usuario_id', req.usuario.id)
      .eq('produto_id', req.params.produto_id);
    
    if (error) throw error;
    res.json({ msg: 'Removido da wishlist' });
  } catch (error) {
    console.error('❌ Erro remover wishlist:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wishlist', verificarToken, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('wishlist')
      .select('*, produtos(*)')
      .eq('usuario_id', req.usuario.id);
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro buscar wishlist:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NEWSLETTER
// ============================================
app.post('/api/newsletter', async function(req, res) {
  try {
    const { email, nome } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    const { data, error } = await supabase
      .from('newsletter')
      .insert([{
        email,
        nome: nome || null,
        data_cadastro: new Date().toISOString()
      }])
      .select();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Email já cadastrado' });
      }
      throw error;
    }
    
    res.json({ msg: 'Inscrito com sucesso!', data: data[0] });
  } catch (error) {
    console.error('❌ Erro newsletter:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN - PRODUTOS
// ============================================
function verificarAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.is_admin) {
    return res.status(403).json({ error: "Acesso negado: apenas administradores" });
  }
  next();
}

app.get('/api/admin/produtos', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .order('id');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('❌ Erro admin produtos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/produtos', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .insert([{ 
        nome: req.body.nome,
        preco: req.body.preco,
        categoria: req.body.categoria,
        imagem: req.body.imagem,
        status: req.body.status || 'novo',
        frete_luanda: req.body.frete_luanda || 0,
        frete_outras: req.body.frete_outras || 5000,
        estoque: req.body.estoque || 'disponivel',
        tempo_entrega: req.body.tempo_entrega || '1-2 dias úteis',
        especificacoes: req.body.especificacoes || {},
        visivel: true 
      }])
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('❌ Erro criar produto:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/produtos/:id', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .update({ 
        nome: req.body.nome,
        preco: req.body.preco,
        categoria: req.body.categoria,
        imagem: req.body.imagem,
        status: req.body.status,
        frete_luanda: req.body.frete_luanda,
        frete_outras: req.body.frete_outras,
        estoque: req.body.estoque,
        tempo_entrega: req.body.tempo_entrega,
        especificacoes: req.body.especificacoes || {}
      })
      .eq('id', req.params.id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('❌ Erro atualizar produto:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/produtos/:id/visibilidade', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { visivel } = req.body;
    
    if (typeof visivel !== 'boolean') {
      return res.status(400).json({ error: 'visivel deve ser boolean' });
    }
    
    const { data, error } = await supabase
      .from('produtos')
      .update({ visivel })
      .eq('id', req.params.id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('❌ Erro visibilidade:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/produtos/:id', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { error } = await supabase
      .from('produtos')
      .delete()
      .eq('id', req.params.id);
    
    if (error) throw error;
    res.json({ msg: "Produto deletado com sucesso" });
  } catch (error) {
    console.error('❌ Erro deletar produto:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN - DASHBOARD
// ============================================
app.get('/api/admin/dashboard', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { count: totalProdutos } = await supabase
      .from('produtos')
      .select('*', { count: 'exact', head: true });
    
    const { count: totalPedidos } = await supabase
      .from('pedidos')
      .select('*', { count: 'exact', head: true });
    
    const { count: totalUsuarios } = await supabase
      .from('usuarios')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      stats: {
        totalProdutos: totalProdutos || 0,
        totalPedidos: totalPedidos || 0,
        totalUsuarios: totalUsuarios || 0
      }
    });
  } catch (error) {
    console.error('❌ Erro dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN - ABANDONOS (SIMPLIFICADO)
// ============================================
const abandonos = [];

app.get('/api/admin/abandonos', verificarToken, verificarAdmin, function(req, res) {
  res.json({
    abandonos: abandonos.filter(a => a.status === 'abandonado'),
    finalizados: abandonos.filter(a => a.status === 'finalizado'),
    total: abandonos.length,
    total_abandonos: abandonos.filter(a => a.status === 'abandonado').length,
    total_finalizados: abandonos.filter(a => a.status === 'finalizado').length
  });
});

app.delete('/api/admin/abandonos/:sessionId', verificarToken, verificarAdmin, function(req, res) {
  const index = abandonos.findIndex(a => a.sessionId === req.params.sessionId);
  if (index === -1) {
    return res.status(404).json({ error: "Registro não encontrado" });
  }
  abandonos.splice(index, 1);
  res.json({ msg: "Registro excluído com sucesso" });
});

app.delete('/api/admin/abandonos/limpar', verificarToken, verificarAdmin, function(req, res) {
  abandonos.length = 0;
  res.json({ msg: "Registros limpos com sucesso" });
});

app.post('/api/checkout/registrar', function(req, res) {
  const { sessionId, usuario, itens } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId é obrigatório" });
  }
  
  const total = (itens || []).reduce((s, i) => s + (i.preco || 0) * (i.quantidade || 1), 0);
  
  const existente = abandonos.find(a => a.sessionId === sessionId);
  
  const registro = {
    sessionId,
    usuario: usuario || { nome: 'Visitante', email: 'Não informado', telefone: 'Não informado' },
    itens: itens || [],
    total,
    step: 'checkout_aberto',
    timestamp: new Date().toISOString(),
    status: 'abandonado',
    tentativas: 0
  };
  
  if (existente) {
    Object.assign(existente, registro);
  } else {
    abandonos.push(registro);
  }
  
  res.json({ msg: "Checkout registrado" });
});

app.post('/api/checkout/step', function(req, res) {
  const { sessionId, step } = req.body;
  
  const registro = abandonos.find(a => a.sessionId === sessionId);
  if (registro) {
    registro.step = step;
    if (step === 'finalizado') {
      registro.status = 'finalizado';
      registro.data_finalizacao = new Date().toISOString();
    }
  }
  
  res.json({ msg: "Step atualizado" });
});

// ============================================
// CHECKOUT
// ============================================
app.post('/api/checkout', verificarToken, async function(req, res) {
  try {
    const usuario_id = req.usuario.id;
    const { itens, endereco, metodo_pagamento, sessionId } = req.body;
    
    if (!itens || itens.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio" });
    }
    
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nome, telefone, regiao, email')
      .eq('id', usuario_id)
      .single();
    
    const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
    
    const { data: pedido, error: errPedido } = await supabase
      .from('pedidos')
      .insert([{ 
        usuario_id, 
        total, 
        status: 'Aguardando WhatsApp',
        endereco: endereco || usuario?.regiao || 'Não informado',
        metodo_pagamento: metodo_pagamento || 'WhatsApp',
        data_pedido: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (errPedido) throw errPedido;
    
    const itensPedido = itens.map(i => ({
      pedido_id: pedido.id,
      produto_id: i.id,
      quantidade: i.quantidade,
      preco_unitario: i.preco
    }));
    
    await supabase
      .from('itens_pedido')
      .insert(itensPedido);
    
    await supabase
      .from('carrinho')
      .delete()
      .eq('usuario_id', usuario_id);
    
    if (sessionId) {
      const abandono = abandonos.find(a => a.sessionId === sessionId);
      if (abandono) {
        abandono.status = 'finalizado';
        abandono.data_finalizacao = new Date().toISOString();
        abandono.pedido_id = pedido.id;
      }
    }
    
    let msg = `*🛍️ NOVO PEDIDO JM STORE #${pedido.id}*\n\n`;
    msg += `👤 *Cliente:* ${usuario?.nome || 'Não informado'}\n`;
    msg += `📧 *Email:* ${usuario?.email || 'Não informado'}\n`;
    msg += `📱 *Telefone:* ${usuario?.telefone || 'Não informado'}\n`;
    msg += `📍 *Região:* ${usuario?.regiao || 'Não informado'}\n`;
    msg += `📦 *Endereço:* ${endereco || usuario?.regiao || 'Não informado'}\n\n`;
    msg += `*📋 ITENS DO PEDIDO:*\n`;
    
    itens.forEach((i, idx) => {
      msg += `${idx + 1}. ${i.nome} x${i.quantidade} = ${(i.preco * i.quantidade).toLocaleString('pt-PT')} KZ\n`;
    });
    
    msg += `\n*💰 TOTAL: ${total.toLocaleString('pt-PT')} KZ*`;
    msg += `\n💳 *Pagamento:* ${metodo_pagamento || 'WhatsApp'}`;
    msg += `\n\n🔗 *Pedido #${pedido.id}*`;
    
    const link = `https://wa.me/${NUMERO_WHATSAPP_JM}?text=${encodeURIComponent(msg)}`;
    
    res.json({ 
      link, 
      pedido_id: pedido.id,
      pedido: {
        id: pedido.id,
        total,
        status: pedido.status,
        data: pedido.data_pedido
      }
    });
  } catch (error) {
    console.error('❌ Erro checkout:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN - UPLOAD (SIMPLIFICADO)
// ============================================
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/admin/upload', verificarToken, verificarAdmin, upload.single('imagem'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  }
  
  // Retornar uma URL temporária (você pode melhorar depois)
  const url = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  res.json({ success: true, url });
});

// ============================================
// VISITANTES
// ============================================
app.post('/api/visitantes/registrar', function(req, res) {
  res.json({ msg: 'Visita registrada' });
});

app.get('/api/admin/visitantes', verificarToken, verificarAdmin, function(req, res) {
  res.json({
    total: 0,
    hoje: 0,
    unicos: 0,
    ultimas: []
  });
});

// ============================================
// CONTATOS MARKETING (SIMPLIFICADO)
// ============================================
app.get('/api/admin/contatos', verificarToken, verificarAdmin, function(req, res) {
  res.json([]);
});

app.get('/api/admin/contatos/exportar', verificarToken, verificarAdmin, function(req, res) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=contatos.csv');
  res.send('Email,Telefone,Nome,Regiao\n');
});

app.post('/api/admin/campanhas', verificarToken, verificarAdmin, function(req, res) {
  res.json({ msg: 'Campanha criada' });
});

// ============================================
// AVALIAÇÕES
// ============================================
app.post('/api/avaliacoes', verificarToken, async function(req, res) {
  try {
    const { produto_id, nota, titulo, comentario } = req.body;
    
    if (!produto_id || !nota) {
      return res.status(400).json({ error: 'Produto e nota são obrigatórios' });
    }
    
    const { data, error } = await supabase
      .from('avaliacoes')
      .insert([{
        produto_id,
        usuario_id: req.usuario.id,
        nota,
        titulo,
        comentario,
        data_criacao: new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    res.json({ msg: 'Avaliação enviada com sucesso!', data: data[0] });
  } catch (error) {
    console.error('❌ Erro avaliação:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/avaliacoes/:produto_id', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('avaliacoes')
      .select('*, usuarios(nome)')
      .eq('produto_id', req.params.produto_id)
      .order('data_criacao', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro buscar avaliações:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PEDIDOS
// ============================================
app.get('/api/pedidos', verificarToken, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, itens_pedido (quantidade, preco_unitario, produtos (*))')
      .eq('usuario_id', req.usuario.id)
      .order('data_pedido', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro pedidos:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pedidos/:id/rastreio', verificarToken, async function(req, res) {
  res.json({
    codigo_rastreio: null,
    transportadora: 'JM Express',
    status: 'Pendente',
    historico_rastreio: []
  });
});

// ============================================
// ADMIN - RASTREIO
// ============================================
app.put('/api/admin/pedidos/:id/rastreio', verificarToken, verificarAdmin, function(req, res) {
  res.json({ msg: 'Rastreio atualizado' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('🚀 JM Server rodando na porta ' + PORT);
  console.log('📊 Teste: https://jm-server.onrender.com/api/test');
  console.log('📦 Produtos: https://jm-server.onrender.com/api/produtos');
});
