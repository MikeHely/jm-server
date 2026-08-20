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

// ===== MIDDLEWARES =====
app.use(cors({
  origin: ['https://jm-store.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// ===== CONFIGURAÇÕES =====
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const NUMERO_WHATSAPP_JM = "244949321312";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("ERRO: falta configurar JWT_SECRET!");
  process.exit(1);
}

// ===== EMAIL CONFIG =====
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  console.log('📧 Email configurado com sucesso!');
} else {
  console.log('⚠️ Email não configurado (variáveis faltando)');
}

// ===== CACHE EM MEMÓRIA =====
const cacheImagens = new Map();
let contadorImagens = 0;
const abandonos = [];
let contadorRegistros = 0;
const LIMITE_NOTIFICACAO = 5;

// ============================================
// MIDDLEWARES DE AUTENTICAÇÃO
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
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

function verificarAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.is_admin) {
    return res.status(403).json({ error: "Acesso negado: apenas administradores" });
  }
  next();
}

// ============================================
// CONFIGURAÇÃO UPLOAD
// ============================================
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const tipos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (tipos.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado'), false);
    }
  }
});

// ============================================
// ROTAS PÚBLICAS
// ============================================

app.get('/api/produtos', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('visivel', true)
      .order('id');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar produtos:', error);
    res.status(500).json({ error: 'Erro ao carregar produtos' });
  }
});

app.get('/api/categorias', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('categoria')
      .eq('visivel', true)
      .order('categoria');
    
    if (error) throw error;
    const categorias = [...new Set(data.map(p => p.categoria))];
    res.json(categorias);
  } catch (error) {
    console.error('Erro ao buscar categorias:', error);
    res.status(500).json({ error: 'Erro ao carregar categorias' });
  }
});

app.get('/api/produtos/:id', async function(req, res) {
  try {
    const { data: produto, error: errProduto } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (errProduto) return res.status(404).json({ error: 'Produto não encontrado' });
    
    const { data: imagens, error: errImagens } = await supabase
      .from('imagens_produtos')
      .select('*')
      .eq('produto_id', req.params.id)
      .order('ordem');
    
    const { data: avaliacoes, error: errAval } = await supabase
      .from('avaliacoes')
      .select('*, usuarios(nome)')
      .eq('produto_id', req.params.id)
      .order('data_criacao', { ascending: false });
    
    const { data: relacionados, error: errRel } = await supabase
      .from('produtos')
      .select('*')
      .eq('categoria', produto.categoria)
      .neq('id', produto.id)
      .limit(4);
    
    res.json({
      ...produto,
      imagens: imagens || [],
      avaliacoes: avaliacoes || [],
      relacionados: relacionados || []
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes do produto:', error);
    res.status(500).json({ error: 'Erro ao carregar detalhes do produto' });
  }
});

// ============================================
// USUÁRIOS
// ============================================

app.post('/api/register', async function(req, res) {
  try {
    const { email, password, nome, telefone, regiao } = req.body;
    const senha = password || req.body.senha;
    
    if (!email || !senha || !nome || !telefone) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    }
    
    const { data: existing, error: errCheck } = await supabase
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
    
    await supabase
      .from('contatos_marketing')
      .insert([{
        email,
        telefone,
        nome,
        regiao,
        origem: 'cadastro',
        data_coleta: new Date().toISOString()
      }]);
    
    res.json({ 
      msg: "Usuário criado com sucesso!",
      user: { id: data[0].id, email, nome }
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: "Erro ao cadastrar usuário" });
  }
});

app.post('/api/login', async function(req, res) {
  try {
    const { email, senha } = req.body;
    
    if (!email || !senha) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !data) {
      return res.status(401).json({ error: "Email ou senha inválidos" });
    }
    
    const senhaCorreta = await bcrypt.compare(senha, data.senha);
    if (!senhaCorreta) {
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
    
    res.json({ 
      msg: "Login realizado com sucesso!", 
      user: usuario, 
      token 
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

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
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: "Erro ao carregar perfil" });
  }
});

app.put('/api/usuario/perfil', verificarToken, async function(req, res) {
  try {
    const { nome, telefone, regiao } = req.body;
    
    const { data, error } = await supabase
      .from('usuarios')
      .update({ nome, telefone, regiao })
      .eq('id', req.usuario.id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: "Erro ao atualizar perfil" });
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
    console.error('Erro ao salvar carrinho:', error);
    res.status(500).json({ error: "Erro ao salvar carrinho" });
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
    
    const itens = data.map(item => ({
      ...item.produtos,
      quantidade: item.quantidade
    }));
    
    res.json(itens);
  } catch (error) {
    console.error('Erro ao buscar carrinho:', error);
    res.status(500).json({ error: "Erro ao carregar carrinho" });
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
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar pedidos:', error);
    res.status(500).json({ error: "Erro ao carregar pedidos" });
  }
});

app.get('/api/pedidos/:id/rastreio', verificarToken, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('codigo_rastreio, transportadora, status, status_atualizado_em, historico_rastreio')
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuario.id)
      .single();
    
    if (error) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar rastreio:', error);
    res.status(500).json({ error: "Erro ao carregar rastreio" });
  }
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
    
    const { data: usuario, error: errUser } = await supabase
      .from('usuarios')
      .select('nome, telefone, regiao, email')
      .eq('id', usuario_id)
      .single();
    
    if (errUser) throw errUser;
    
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
    
    const { error: errItens } = await supabase
      .from('itens_pedido')
      .insert(itensPedido);
    
    if (errItens) throw errItens;
    
    await supabase
      .from('carrinho')
      .delete()
      .eq('usuario_id', usuario_id);
    
    await supabase
      .from('contatos_marketing')
      .upsert({
        email: usuario.email,
        telefone: usuario.telefone,
        nome: usuario.nome,
        regiao: usuario.regiao,
        origem: 'checkout',
        total_compras: supabase.raw('total_compras + 1'),
        total_gasto: supabase.raw(`total_gasto + ${total}`),
        ultimo_contato: new Date().toISOString()
      }, { onConflict: 'email' });
    
    if (sessionId) {
      const abandono = abandonos.find(a => a.sessionId === sessionId);
      if (abandono) {
        abandono.status = 'finalizado';
        abandono.data_finalizacao = new Date().toISOString();
        abandono.pedido_id = pedido.id;
      }
    }
    
    if (abandonos.length > 0 && abandonos.length % LIMITE_NOTIFICACAO === 0) {
      const ultimosRegistros = abandonos.slice(-LIMITE_NOTIFICACAO);
      enviarEmailNotificacao(ultimosRegistros).catch(console.error);
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
    
    // Enviar email de notificação via Nodemailer
    if (transporter && usuario?.email) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_NOTIFICACAO || process.env.EMAIL_USER,
          subject: `🛍️ NOVO PEDIDO JM STORE #${pedido.id}`,
          html: `
            <h2>🛍️ NOVO PEDIDO JM STORE</h2>
            <p><strong>Pedido #:</strong> ${pedido.id}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleString('pt-PT')}</p>
            <h3>👤 DADOS DO CLIENTE</h3>
            <p><strong>Nome:</strong> ${usuario?.nome || 'Não informado'}</p>
            <p><strong>Email:</strong> ${usuario?.email || 'Não informado'}</p>
            <p><strong>Telefone:</strong> ${usuario?.telefone || 'Não informado'}</p>
            <p><strong>Região:</strong> ${usuario?.regiao || 'Não informado'}</p>
            <p><strong>Endereço:</strong> ${endereco || usuario?.regiao || 'Não informado'}</p>
            <h3>📋 ITENS DO PEDIDO</h3>
            ${itens.map(i => `<p>${i.nome} x${i.quantidade} = ${(i.preco * i.quantidade).toLocaleString('pt-PT')} KZ</p>`).join('')}
            <h3>💰 TOTAL: ${total.toLocaleString('pt-PT')} KZ</h3>
            <p><strong>Pagamento:</strong> ${metodo_pagamento || 'WhatsApp'}</p>
            <p style="color: #666; font-size: 12px;">Este email foi enviado automaticamente pela JM Store.</p>
          `
        });
        console.log('📧 Email de notificação enviado!');
      } catch (error) {
        console.error('❌ Erro ao enviar email:', error);
      }
    }
    
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
    console.error('Erro no checkout:', error);
    res.status(500).json({ error: "Erro ao processar pedido" });
  }
});

// ============================================
// RASTREIO DE ABANDONO
// ============================================

app.post('/api/checkout/registrar', async function(req, res) {
  try {
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
      tentativas: 0,
      ultimo_contato: null
    };
    
    if (existente) {
      Object.assign(existente, registro);
    } else {
      abandonos.push(registro);
      contadorRegistros++;
    }
    
    res.json({ msg: "Checkout registrado" });
  } catch (error) {
    console.error('Erro ao registrar checkout:', error);
    res.status(500).json({ error: "Erro ao registrar checkout" });
  }
});

app.post('/api/checkout/step', async function(req, res) {
  try {
    const { sessionId, step, dados } = req.body;
    
    const registro = abandonos.find(a => a.sessionId === sessionId);
    if (registro) {
      registro.step = step;
      if (dados) {
        registro.usuario = { ...registro.usuario, ...dados };
      }
      if (step === 'finalizado') {
        registro.status = 'finalizado';
        registro.data_finalizacao = new Date().toISOString();
      }
    }
    
    res.json({ msg: "Step atualizado" });
  } catch (error) {
    console.error('Erro ao atualizar step:', error);
    res.status(500).json({ error: "Erro ao atualizar step" });
  }
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
    console.error('Erro ao salvar avaliação:', error);
    res.status(500).json({ error: "Erro ao enviar avaliação" });
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
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar avaliações:', error);
    res.status(500).json({ error: "Erro ao carregar avaliações" });
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
    console.error('Erro ao adicionar à wishlist:', error);
    res.status(500).json({ error: "Erro ao adicionar à wishlist" });
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
    console.error('Erro ao remover da wishlist:', error);
    res.status(500).json({ error: "Erro ao remover da wishlist" });
  }
});

app.get('/api/wishlist', verificarToken, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('wishlist')
      .select('*, produtos(*)')
      .eq('usuario_id', req.usuario.id);
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar wishlist:', error);
    res.status(500).json({ error: "Erro ao carregar wishlist" });
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
    
    const token = Math.random().toString(36).substr(2, 10);
    
    const { data, error } = await supabase
      .from('newsletter')
      .insert([{
        email,
        nome: nome || null,
        token_confirmacao: token,
        data_cadastro: new Date().toISOString()
      }])
      .select();
    
    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Email já cadastrado' });
      }
      throw error;
    }
    
    await supabase
      .from('contatos_marketing')
      .insert([{
        email,
        nome: nome || null,
        origem: 'newsletter',
        data_coleta: new Date().toISOString()
      }]);
    
    res.json({ msg: 'Inscrito com sucesso!', data: data[0] });
  } catch (error) {
    console.error('Erro na newsletter:', error);
    res.status(500).json({ error: "Erro ao inscrever na newsletter" });
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
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar FAQ:', error);
    res.status(500).json({ error: "Erro ao carregar FAQ" });
  }
});

// ============================================
// VISITANTES
// ============================================

app.post('/api/visitantes/registrar', async function(req, res) {
  try {
    const { sessionId, pagina } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Desconhecido';
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId é obrigatório' });
    }
    
    const { error } = await supabase
      .from('visitantes')
      .insert([{
        session_id: sessionId,
        ip: ip,
        user_agent: userAgent,
        pagina: pagina || '/',
        data_visita: new Date().toISOString()
      }]);
    
    if (error) throw error;
    res.json({ msg: 'Visita registrada' });
  } catch (error) {
    console.error('Erro ao registrar visita:', error);
    res.status(500).json({ error: 'Erro ao registrar visita' });
  }
});

app.get('/api/admin/visitantes', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data: totalVisitas, error: errTotal } = await supabase
      .from('visitantes')
      .select('*', { count: 'exact', head: true });
    
    if (errTotal) throw errTotal;
    
    const hoje = new Date().toISOString().split('T')[0];
    const { data: visitasHoje, error: errHoje } = await supabase
      .from('visitantes')
      .select('*', { count: 'exact', head: true })
      .gte('data_visita', hoje);
    
    if (errHoje) throw errHoje;
    
    const { data: visitantesUnicos, error: errUnicos } = await supabase
      .from('visitantes')
      .select('session_id')
      .order('session_id');
    
    if (errUnicos) throw errUnicos;
    
    const unicos = [...new Set(visitantesUnicos.map(v => v.session_id))];
    
    const { data: ultimasVisitas, error: errUltimas } = await supabase
      .from('visitantes')
      .select('*')
      .order('data_visita', { ascending: false })
      .limit(20);
    
    if (errUltimas) throw errUltimas;
    
    res.json({
      total: totalVisitas || 0,
      hoje: visitasHoje || 0,
      unicos: unicos.length || 0,
      ultimas: ultimasVisitas || []
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas de visitantes:', error);
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

// ============================================
// ADMIN - PRODUTOS
// ============================================

app.get('/api/admin/produtos', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .order('id');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar produtos (admin):', error);
    res.status(500).json({ error: "Erro ao carregar produtos" });
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
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: "Erro ao criar produto" });
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
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: "Erro ao atualizar produto" });
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
    console.error('Erro ao alterar visibilidade:', error);
    res.status(500).json({ error: "Erro ao alterar visibilidade" });
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
    console.error('Erro ao deletar produto:', error);
    res.status(500).json({ error: "Erro ao deletar produto" });
  }
});

// ============================================
// ADMIN - IMAGENS
// ============================================

app.post('/api/admin/imagens', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { produto_id, urls } = req.body;
    
    if (!produto_id || !urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    
    await supabase
      .from('imagens_produtos')
      .delete()
      .eq('produto_id', produto_id);
    
    const imagens = urls.map((url, index) => ({
      produto_id,
      url,
      ordem: index
    }));
    
    const { data, error } = await supabase
      .from('imagens_produtos')
      .insert(imagens)
      .select();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao salvar imagens:', error);
    res.status(500).json({ error: "Erro ao salvar imagens" });
  }
});

// ============================================
// ADMIN - UPLOAD
// ============================================

app.post('/api/admin/upload', verificarToken, verificarAdmin, upload.single('imagem'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    const buffer = await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const id = ++contadorImagens;
    const nome = `img_${id}_${Date.now()}.jpg`;
    
    cacheImagens.set(id, {
      buffer,
      mimeType: 'image/jpeg',
      nome,
      tamanho: buffer.length,
      criado_em: new Date().toISOString()
    });

    const url = `${req.protocol}://${req.get('host')}/api/imagem/${id}`;
    res.json({ success: true, url, id });
  } catch (error) {
    console.error('Erro no upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
});

app.get('/api/imagem/:id', function(req, res) {
  const id = parseInt(req.params.id);
  const imagem = cacheImagens.get(id);
  
  if (!imagem) {
    return res.status(404).json({ error: 'Imagem não encontrada' });
  }
  
  res.set('Content-Type', imagem.mimeType);
  res.set('Cache-Control', 'public, max-age=31536000');
  res.send(imagem.buffer);
});

// ============================================
// ADMIN - ABANDONOS
// ============================================

app.get('/api/admin/abandonos', verificarToken, verificarAdmin, function(req, res) {
  const abandonados = abandonos.filter(a => a.status === 'abandonado');
  const finalizados = abandonos.filter(a => a.status === 'finalizado');
  
  res.json({
    abandonos: abandonados,
    finalizados: finalizados,
    total: abandonos.length,
    total_abandonos: abandonados.length,
    total_finalizados: finalizados.length
  });
});

app.delete('/api/admin/abandonos/:sessionId', verificarToken, verificarAdmin, function(req, res) {
  const sessionId = req.params.sessionId;
  const index = abandonos.findIndex(a => a.sessionId === sessionId);
  
  if (index === -1) {
    return res.status(404).json({ error: "Registro não encontrado" });
  }
  
  abandonos.splice(index, 1);
  res.json({ msg: "Registro excluído com sucesso" });
});

app.delete('/api/admin/abandonos/limpar', verificarToken, verificarAdmin, function(req, res) {
  const { tipo } = req.body;
  
  if (tipo === 'todos') {
    abandonos.length = 0;
    contadorRegistros = 0;
  } else if (tipo === 'abandonados') {
    const finalizados = abandonos.filter(a => a.status === 'finalizado');
    abandonos.length = 0;
    abandonos.push(...finalizados);
  } else if (tipo === 'finalizados') {
    const abandonados = abandonos.filter(a => a.status === 'abandonado');
    abandonos.length = 0;
    abandonos.push(...abandonados);
  }
  
  res.json({ msg: "Registros limpos com sucesso" });
});

app.post('/api/admin/notificar-whatsapp', verificarToken, verificarAdmin, function(req, res) {
  const { sessionId, mensagemPersonalizada } = req.body;
  
  const abandono = abandonos.find(a => a.sessionId === sessionId);
  if (!abandono) {
    return res.status(404).json({ error: "Abandono não encontrado" });
  }
  
  if (!abandono.usuario?.telefone || abandono.usuario.telefone === 'Não informado') {
    return res.status(400).json({ error: "Usuário não tem telefone cadastrado" });
  }
  
  let mensagem = mensagemPersonalizada || 
    `🛍️ *JM Store - Carrinho Abandonado*\n\n` +
    `Olá ${abandono.usuario.nome || 'cliente'}! 👋\n\n` +
    `Vimos que você deixou alguns produtos no carrinho. Quer finalizar sua compra?\n\n` +
    `📦 *Itens:*\n`;
  
  abandono.itens.forEach(item => {
    mensagem += `- ${item.nome} x${item.quantidade}: ${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ\n`;
  });
  
  mensagem += `\n💰 *Total: ${abandono.total.toLocaleString('pt-PT')} KZ*\n\n`;
  mensagem += `Acesse: ${process.env.STORE_URL || 'https://jm-store.vercel.app'}\n\n`;
  mensagem += `*Responda esta mensagem para finalizar seu pedido!* 🚀`;
  
  const link = `https://wa.me/${abandono.usuario.telefone}?text=${encodeURIComponent(mensagem)}`;
  
  abandono.tentativas++;
  abandono.ultimo_contato = new Date().toISOString();
  
  res.json({ 
    success: true, 
    link,
    mensagem,
    telefone: abandono.usuario.telefone
  });
});

// ============================================
// ADMIN - RASTREIO
// ============================================

app.put('/api/admin/pedidos/:id/rastreio', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { codigo_rastreio, transportadora, status, observacao } = req.body;
    const pedidoId = req.params.id;
    
    const { data: pedido, error: errBusca } = await supabase
      .from('pedidos')
      .select('historico_rastreio')
      .eq('id', pedidoId)
      .single();
    
    if (errBusca) return res.status(404).json({ error: 'Pedido não encontrado' });
    
    const historico = pedido.historico_rastreio || [];
    historico.push({
      status: status || 'Atualizado',
      observacao: observacao || '',
      data: new Date().toISOString()
    });
    
    const { data, error } = await supabase
      .from('pedidos')
      .update({
        codigo_rastreio: codigo_rastreio || null,
        transportadora: transportadora || 'JM Express',
        status: status || pedido.status,
        status_atualizado_em: new Date().toISOString(),
        historico_rastreio: historico
      })
      .eq('id', pedidoId)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Erro ao atualizar rastreio:', error);
    res.status(500).json({ error: "Erro ao atualizar rastreio" });
  }
});

// ============================================
// ADMIN - MARKETING
// ============================================

app.get('/api/admin/contatos', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('contatos_marketing')
      .select('*')
      .order('data_coleta', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar contatos:', error);
    res.status(500).json({ error: "Erro ao carregar contatos" });
  }
});

app.get('/api/admin/contatos/exportar', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('contatos_marketing')
      .select('email, telefone, nome, regiao, origem, data_coleta, total_compras, total_gasto');
    
    if (error) throw error;
    
    const headers = ['Email', 'Telefone', 'Nome', 'Região', 'Origem', 'Data Coleta', 'Compras', 'Gasto Total'];
    let csv = headers.join(',') + '\n';
    
    data.forEach(c => {
      const row = [
        c.email || '',
        c.telefone || '',
        c.nome || '',
        c.regiao || '',
        c.origem || '',
        new Date(c.data_coleta).toLocaleDateString('pt-PT'),
        c.total_compras || 0,
        (c.total_gasto || 0).toLocaleString('pt-PT') + ' KZ'
      ];
      csv += row.join(',') + '\n';
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=contatos_marketing.csv');
    res.send(csv);
  } catch (error) {
    console.error('Erro ao exportar contatos:', error);
    res.status(500).json({ error: "Erro ao exportar contatos" });
  }
});

app.post('/api/admin/campanhas', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { lista_id, titulo, mensagem, tipo, enviar_agora } = req.body;
    
    const { data: campanha, error: errCamp } = await supabase
      .from('campanhas_marketing')
      .insert([{
        lista_id,
        titulo,
        mensagem,
        tipo: tipo || 'email',
        data_criacao: new Date().toISOString(),
        data_envio: enviar_agora ? new Date().toISOString() : null
      }])
      .select()
      .single();
    
    if (errCamp) throw errCamp;
    
    if (enviar_agora && transporter) {
      const { data: contatos } = await supabase
        .from('contatos_marketing')
        .select('email')
        .eq('lista_id', lista_id)
        .eq('ativo', true);
      
      let enviados = 0;
      if (contatos) {
        for (const contato of contatos) {
          if (contato.email && tipo === 'email') {
            try {
              await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: contato.email,
                subject: titulo,
                html: mensagem.replace(/\n/g, '<br>')
              });
              enviados++;
            } catch (error) {
              console.error('Erro ao enviar para:', contato.email, error);
            }
          }
        }
      }
      
      await supabase
        .from('campanhas_marketing')
        .update({ enviados })
        .eq('id', campanha.id);
    }
    
    res.json({ msg: 'Campanha criada com sucesso!', campanha });
  } catch (error) {
    console.error('Erro ao criar campanha:', error);
    res.status(500).json({ error: "Erro ao criar campanha" });
  }
});

app.get('/api/admin/campanhas', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('campanhas_marketing')
      .select('*, listas_marketing(nome)')
      .order('data_criacao', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar campanhas:', error);
    res.status(500).json({ error: "Erro ao carregar campanhas" });
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
    
    const { data: pedidosRecentes } = await supabase
      .from('pedidos')
      .select('*, usuarios (nome, email, telefone)')
      .order('data_pedido', { ascending: false })
      .limit(5);
    
    const totalAbandonos = abandonos.filter(a => a.status === 'abandonado').length;
    const totalFinalizados = abandonos.filter(a => a.status === 'finalizado').length;
    
    res.json({
      stats: {
        totalProdutos: totalProdutos || 0,
        totalPedidos: totalPedidos || 0,
        totalUsuarios: totalUsuarios || 0,
        totalAbandonos,
        totalFinalizados
      },
      pedidosRecentes: pedidosRecentes || []
    });
  } catch (error) {
    console.error('Erro no dashboard:', error);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

// ============================================
// FUNÇÃO PARA ENVIAR EMAIL DE NOTIFICAÇÃO
// ============================================

async function enviarEmailNotificacao(novosRegistros) {
  if (!transporter) {
    console.log('⚠️ Email não enviado: transporte não configurado');
    return false;
  }

  try {
    const abandonosLista = novosRegistros.filter(r => r.status === 'abandonado');
    const finalizadosLista = novosRegistros.filter(r => r.status === 'finalizado');
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1E3A8A; color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px; }
          .card { background: white; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #1E3A8A; }
          .card-abandono { border-left-color: #F59E0B; }
          .card-finalizado { border-left-color: #22C55E; }
          .status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
          .status-abandono { background: #FEF3C7; color: #92400E; }
          .status-finalizado { background: #D1FAE5; color: #065F46; }
          .total { font-size: 24px; font-weight: bold; color: #16A34A; text-align: right; }
          .footer { margin-top: 20px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
          .botao-admin { 
            display: inline-block; 
            background: #1E3A8A; 
            color: white; 
            padding: 10px 20px; 
            text-decoration: none; 
            border-radius: 8px;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 NOVOS DADOS - JM Store</h1>
          <p>${novosRegistros.length} novos registros detectados!</p>
        </div>
        
        <div class="content">
          <h3>📋 Resumo:</h3>
          <ul>
            <li>🛒 Abandonos: ${abandonosLista.length}</li>
            <li>✅ Finalizados: ${finalizadosLista.length}</li>
            <li>💰 Total em vendas potenciais: ${finalizadosLista.reduce((s, r) => s + (r.total || 0), 0).toLocaleString('pt-PT')} KZ</li>
          </ul>
    `;
    
    if (abandonosLista.length > 0) {
      html += `<h3 style="color:#92400E; margin-top:20px;">🛒 ABANDONOS (${abandonosLista.length})</h3>`;
      for (const ab of abandonosLista) {
        html += `
          <div class="card card-abandono">
            <div style="display:flex; justify-content:space-between;">
              <div>
                <strong>${ab.usuario?.nome || 'Visitante'}</strong>
                <span style="display:block; font-size:13px; color:#666;">
                  📧 ${ab.usuario?.email || 'Não informado'} | 📱 ${ab.usuario?.telefone || 'Não informado'}
                </span>
              </div>
              <div>
                <span class="status status-abandono">🛒 Abandonado</span>
                <span style="display:block; font-weight:bold; color:#92400E;">💰 ${(ab.total || 0).toLocaleString('pt-PT')} KZ</span>
              </div>
            </div>
            <details>
              <summary style="cursor:pointer; font-size:13px; color:#1E3A8A;">Ver itens</summary>
              ${ab.itens?.map(item => `
                <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                  <span>${item.nome}</span>
                  <span>x${item.quantidade}</span>
                  <span style="margin-left:auto;">${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ</span>
                </div>
              `).join('') || '<p style="color:#999;">Sem itens</p>'}
            </details>
          </div>
        `;
      }
    }
    
    if (finalizadosLista.length > 0) {
      html += `<h3 style="color:#065F46; margin-top:20px;">✅ FINALIZADOS (${finalizadosLista.length})</h3>`;
      for (const fin of finalizadosLista) {
        html += `
          <div class="card card-finalizado">
            <div style="display:flex; justify-content:space-between;">
              <div>
                <strong>${fin.usuario?.nome || 'Visitante'}</strong>
                <span style="display:block; font-size:13px; color:#666;">
                  📧 ${fin.usuario?.email || 'Não informado'} | 📱 ${fin.usuario?.telefone || 'Não informado'}
                </span>
                <span style="font-size:12px; color:#999;">🕐 ${new Date(fin.timestamp).toLocaleString('pt-PT')}</span>
              </div>
              <div>
                <span class="status status-finalizado">✅ Finalizado</span>
                <span style="display:block; font-weight:bold; color:#16A34A;">💰 ${(fin.total || 0).toLocaleString('pt-PT')} KZ</span>
                ${fin.pedido_id ? `<span style="display:block; font-size:12px; color:#3B82F6;">📋 Pedido #${fin.pedido_id}</span>` : ''}
              </div>
            </div>
            <details>
              <summary style="cursor:pointer; font-size:13px; color:#1E3A8A;">Ver itens</summary>
              ${fin.itens?.map(item => `
                <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                  <span>${item.nome}</span>
                  <span>x${item.quantidade}</span>
                  <span style="margin-left:auto;">${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ</span>
                </div>
              `).join('') || '<p style="color:#999;">Sem itens</p>'}
            </details>
          </div>
        `;
      }
    }
    
    html += `
          <div style="text-align:center; margin-top:20px;">
            <a href="${process.env.ADMIN_URL || 'https://jm-store.vercel.app/admin.html'}" class="botao-admin">
              📊 Ver no Painel Admin
            </a>
          </div>
          
          <div class="footer">
            <p>Este email foi enviado automaticamente pela JM Store.</p>
            <p>© 2024 JM Store - Luanda, Angola</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_NOTIFICACAO,
      subject: `📊 JM Store - ${novosRegistros.length} novos registros!`,
      html
    });
    
    console.log(`📧 Email enviado com ${novosRegistros.length} registros`);
    return true;
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
    return false;
  }
}

// ============================================
// COLETAR CONTATOS PARA MARKETING
// ============================================

async function coletarContatosMarketing() {
  try {
    const { data: usuarios } = await supabase
      .from('usuarios')
      .select('id, email, nome, telefone, regiao, data_cadastro')
      .not('email', 'is', null);
    
    if (usuarios) {
      for (const user of usuarios) {
        const { data: existente } = await supabase
          .from('contatos_marketing')
          .select('id')
          .eq('email', user.email)
          .single();
        
        if (!existente) {
          await supabase
            .from('contatos_marketing')
            .insert([{
              email: user.email,
              telefone: user.telefone,
              nome: user.nome,
              regiao: user.regiao,
              origem: 'cadastro',
              data_coleta: user.data_cadastro || new Date().toISOString()
            }]);
        }
      }
    }
    
    for (const abandono of abandonos) {
      if (abandono.usuario?.email) {
        const { data: existente } = await supabase
          .from('contatos_marketing')
          .select('id')
          .eq('email', abandono.usuario.email)
          .single();
        
        if (!existente) {
          await supabase
            .from('contatos_marketing')
            .insert([{
              email: abandono.usuario.email,
              telefone: abandono.usuario.telefone || null,
              nome: abandono.usuario.nome || 'Visitante',
              regiao: abandono.usuario.regiao || null,
              origem: 'abandono',
              data_coleta: new Date().toISOString()
            }]);
        }
      }
    }
    
    console.log('✅ Coleta de contatos para marketing concluída');
  } catch (error) {
    console.error('❌ Erro na coleta de contatos:', error);
  }
}

setInterval(coletarContatosMarketing, 3600000);

// ============================================
// INICIAR SERVIDOR
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('🚀 JM Server rodando na porta ' + PORT);
  console.log('📊 API URL: http://localhost:' + PORT + '/api/produtos');
});