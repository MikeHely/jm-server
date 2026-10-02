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
const brevo = require('@getbrevo/brevo');
require('dotenv').config();

const app = express();

// ============================================
// 🔥 CORS CORRETO
// ============================================
const allowedOrigins = [
  'https://mikehely.github.io',
  'https://jm-store.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://jm-server.onrender.com'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueou:', origin);
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
}));

app.options('*', cors());
app.use(express.json({ limit: '50mb' }));

// ============================================
// LOG DE REQUISIÇÕES
// ============================================
app.use(function(req, res, next) {
  console.log('📡 ' + req.method + ' ' + req.url + ' - Origin: ' + req.headers.origin);
  next();
});

// ============================================
// CONFIGURAÇÕES
// ============================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const NUMERO_WHATSAPP_JM = "244953652742";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("ERRO: falta configurar JWT_SECRET!");
  process.exit(1);
}

// ============================================
// 📧 EMAIL CONFIG - BREVO API (HTTPS)
// ============================================
let brevoApiInstance = null;
let emailConfigurado = false;

if (process.env.BREVO_API_KEY) {
  try {
    brevoApiInstance = new brevo.TransactionalEmailsApi();
    brevoApiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );
    emailConfigurado = true;
    console.log('📧 Brevo API configurada com sucesso!');
    console.log('📧 API Key:', process.env.BREVO_API_KEY.substring(0, 20) + '...');
    console.log('📧 Notificações para:', process.env.EMAIL_NOTIFICACAO);
  } catch (error) {
    console.error('❌ Erro Brevo API:', error.message);
  }
} else {
  console.log('⚠️ BREVO_API_KEY não configurada');
}

// ============================================
// FUNÇÃO PARA ENVIAR NOTIFICAÇÃO
// ============================================
async function enviarNotificacaoEmail(tipo, dados) {
  if (!brevoApiInstance) {
    console.log('⚠️ Email não enviado: Brevo API não configurada');
    return false;
  }

  try {
    let assunto = '';
    let html = '';
    const safeDados = dados || {};

    if (tipo === 'novo_usuario') {
      assunto = '🆕 Novo Usuário Cadastrado - JM Store';
      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1E3A8A; color: white; padding: 20px; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0;">🆕 Novo Usuário Cadastrado</h1>
          </div>
          <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px;">
            <p><strong>Nome:</strong> ${safeDados.nome || 'Não informado'}</p>
            <p><strong>Email:</strong> ${safeDados.email || 'Não informado'}</p>
            <p><strong>Telefone:</strong> ${safeDados.telefone || 'Não informado'}</p>
            <p><strong>Região:</strong> ${safeDados.regiao || 'Não informado'}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleString('pt-PT')}</p>
          </div>
        </div>
      `;
    } else if (tipo === 'pedido_finalizado') {
      assunto = '🛍️ Novo Pedido Finalizado - JM Store #' + (safeDados.pedido_id || 'PENDENTE');
      
      let itensHtml = '';
      if (safeDados.itens && Array.isArray(safeDados.itens)) {
        itensHtml = safeDados.itens.map(i => 
          `<p>${i.nome || 'Produto'} x${i.quantidade || 1} = ${((i.preco || 0) * (i.quantidade || 1)).toLocaleString('pt-PT')} KZ</p>`
        ).join('');
      } else {
        itensHtml = '<p>Nenhum item listado</p>';
      }

      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1E3A8A; color: white; padding: 20px; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0;">🛍️ NOVO PEDIDO FINALIZADO</h1>
            <p style="margin: 5px 0 0 0;">Pedido #${safeDados.pedido_id || 'PENDENTE'}</p>
          </div>
          <div style="background: #f8fafc; padding: 20px; border-radius: 0 0 10px 10px;">
            <p><strong>Data:</strong> ${new Date().toLocaleString('pt-PT')}</p>
            <h3>👤 DADOS DO CLIENTE</h3>
            <p><strong>Nome:</strong> ${safeDados.nome || 'Não informado'}</p>
            <p><strong>Email:</strong> ${safeDados.email || 'Não informado'}</p>
            <p><strong>Telefone:</strong> ${safeDados.telefone || 'Não informado'}</p>
            <p><strong>Região:</strong> ${safeDados.regiao || 'Não informado'}</p>
            <p><strong>Endereço:</strong> ${safeDados.endereco || 'Não informado'}</p>
            <h3>📋 ITENS DO PEDIDO</h3>
            ${itensHtml}
            <h3 style="color: #16A34A;">💰 TOTAL: ${(safeDados.total || 0).toLocaleString('pt-PT')} KZ</h3>
            <p><strong>Pagamento:</strong> ${safeDados.metodo_pagamento || 'WhatsApp'}</p>
          </div>
        </div>
      `;
    } else if (tipo === 'abandono') {
      assunto = '🛒 Carrinho Abandonado - JM Store';
      
      let itensHtml = '';
      if (safeDados.itens && Array.isArray(safeDados.itens)) {
        itensHtml = safeDados.itens.map(i => 
          `<p>${i.nome || 'Produto'} x${i.quantidade || 1} = ${((i.preco || 0) * (i.quantidade || 1)).toLocaleString('pt-PT')} KZ</p>`
        ).join('');
      } else {
        itensHtml = '<p>Nenhum item no carrinho</p>';
      }

      html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #F59E0B; color: white; padding: 20px; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0;">🛒 CARRINHO ABANDONADO</h1>
          </div>
          <div style="background: #FFF7ED; padding: 20px; border-radius: 0 0 10px 10px;">
            <p><strong>Data:</strong> ${new Date().toLocaleString('pt-PT')}</p>
            <h3>👤 DADOS DO CLIENTE</h3>
            <p><strong>Nome:</strong> ${safeDados.nome || 'Visitante'}</p>
            <p><strong>Email:</strong> ${safeDados.email || 'Não informado'}</p>
            <p><strong>Telefone:</strong> ${safeDados.telefone || 'Não informado'}</p>
            <h3>📋 ITENS NO CARRINHO</h3>
            ${itensHtml}
            <h3 style="color: #92400E;">💰 TOTAL: ${(safeDados.total || 0).toLocaleString('pt-PT')} KZ</h3>
          </div>
        </div>
      `;
    }

    // ✅ Enviar via API REST (HTTPS - nunca bloqueado)
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = assunto;
    sendSmtpEmail.htmlContent = html;
    sendSmtpEmail.sender = { 
      name: 'JM Store', 
      email: process.env.EMAIL_NOTIFICACAO
    };
    sendSmtpEmail.to = [{ 
      email: process.env.EMAIL_NOTIFICACAO,
      name: 'Admin JM Store'
    }];

    const result = await brevoApiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Email enviado (Brevo API): ${tipo} - ID: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error.message);
    if (error.response && error.response.body) {
      console.error('❌ Detalhes:', JSON.stringify(error.response.body, null, 2));
    }
    return false;
  }
}

// ============================================
// ROTA DE TESTE
// ============================================
app.get('/api/test', function(req, res) {
  res.json({ 
    status: 'online', 
    time: new Date().toISOString(),
    message: '🚀 JM Server está funcionando!',
    email: emailConfigurado ? '✅ Brevo configurado' : '⚠️ Brevo não configurado',
    cors: '✅ Configurado'
  });
});

app.get('/', function(req, res) {
  res.json({ 
    message: 'JM Store API',
    endpoints: {
      test: '/api/test',
      testEmail: '/api/test-email',
      produtos: '/api/produtos',
      login: '/api/login',
      register: '/api/register'
    }
  });
});

// ============================================
// ROTA DE TESTE DE EMAIL
// ============================================
app.get('/api/test-email', async function(req, res) {
  try {
    if (!brevoApiInstance) {
      return res.status(500).json({ 
        error: 'Brevo API não configurada',
        BREVO_API_KEY: process.env.BREVO_API_KEY ? 'Definido' : 'Faltando',
        EMAIL_NOTIFICACAO: process.env.EMAIL_NOTIFICACAO ? 'Definido' : 'Faltando'
      });
    }
    
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = '🧪 Teste JM Store - Brevo API';
    sendSmtpEmail.htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1 style="color: #1E3A8A;">✅ Email funcionando!</h1>
        <p>A API do Brevo está configurada corretamente.</p>
        <p><strong>Data:</strong> ${new Date().toLocaleString('pt-PT')}</p>
        <p><strong>Enviado para:</strong> ${process.env.EMAIL_NOTIFICACAO}</p>
      </div>
    `;
    sendSmtpEmail.sender = { 
      name: 'JM Store', 
      email: process.env.EMAIL_NOTIFICACAO 
    };
    sendSmtpEmail.to = [{ 
      email: process.env.EMAIL_NOTIFICACAO,
      name: 'Admin JM Store'
    }];

    const result = await brevoApiInstance.sendTransacEmail(sendSmtpEmail);
    
    res.json({ 
      success: true, 
      msg: 'Email enviado! Verifique a caixa de entrada.',
      messageId: result.messageId
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      details: error.response ? error.response.body : null
    });
  }
});

// ============================================
// PRODUTOS
// ============================================
app.get('/api/produtos', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .eq('visivel', true)
      .order('id');
    
    if (error) throw error;
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
    
    // Email em background
    enviarNotificacaoEmail('novo_usuario', { nome, email, telefone, regiao })
      .catch(err => console.error('Erro email novo usuário:', err));
    
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
    
    const token = jwt.sign(usuario, JWT_SECRET, { expiresIn: '90d' });
    
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
// MIDDLEWARES
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

function verificarAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.is_admin) {
    return res.status(403).json({ error: "Acesso negado: apenas administradores" });
  }
  next();
}

// ============================================
// USUÁRIOS - PERFIL
// ============================================
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
    console.error('❌ Erro atualizar perfil:', error);
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
// CHECKOUT E ABANDONOS
// ============================================
const abandonos = [];

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
      tentativas: 0
    };
    
    if (existente) {
      Object.assign(existente, registro);
    } else {
      abandonos.push(registro);
      
      // Email em background
      enviarNotificacaoEmail('abandono', {
        nome: usuario?.nome || 'Visitante',
        email: usuario?.email || 'Não informado',
        telefone: usuario?.telefone || 'Não informado',
        itens: itens || [],
        total: total
      }).catch(err => console.error('Erro email abandono:', err));
    }
    
    res.json({ msg: "Checkout registrado" });
  } catch (error) {
    console.error('❌ Erro ao registrar abandono:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout/step', function(req, res) {
  try {
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
  } catch (error) {
    console.error('❌ Erro ao atualizar step:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/checkout', verificarToken, async function(req, res) {
  try {
    const usuario_id = req.usuario.id;
    const { itens, endereco, metodo_pagamento, sessionId } = req.body;
    
    if (!itens || itens.length === 0) {
      return res.status(400).json({ error: "Carrinho vazio" });
    }
    
    const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
    
    const [usuarioResult, pedidoResult] = await Promise.all([
      supabase
        .from('usuarios')
        .select('nome, telefone, regiao, email')
        .eq('id', usuario_id)
        .single(),
      supabase
        .from('pedidos')
        .insert([{ 
          usuario_id, 
          total, 
          status: 'Aguardando WhatsApp',
          endereco: endereco || 'Não informado',
          metodo_pagamento: metodo_pagamento || 'WhatsApp',
          data_pedido: new Date().toISOString()
        }])
        .select()
        .single()
    ]);
    
    const usuario = usuarioResult.data;
    const pedido = pedidoResult.data;
    
    if (pedidoResult.error) throw pedidoResult.error;
    
    await Promise.all([
      supabase.from('itens_pedido').insert(itens.map(i => ({
        pedido_id: pedido.id,
        produto_id: i.id,
        quantidade: i.quantidade,
        preco_unitario: i.preco
      }))),
      supabase.from('carrinho').delete().eq('usuario_id', usuario_id)
    ]);
    
    if (sessionId) {
      const abandono = abandonos.find(a => a.sessionId === sessionId);
      if (abandono) {
        abandono.status = 'finalizado';
        abandono.data_finalizacao = new Date().toISOString();
        abandono.pedido_id = pedido.id;
      }
    }
    
    // Email em background
    enviarNotificacaoEmail('pedido_finalizado', {
      pedido_id: pedido.id,
      nome: usuario?.nome,
      email: usuario?.email,
      telefone: usuario?.telefone,
      regiao: usuario?.regiao,
      endereco: endereco || usuario?.regiao,
      itens: itens,
      total: total,
      metodo_pagamento: metodo_pagamento || 'WhatsApp'
    }).catch(err => console.error('Erro email pedido:', err));
    
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
    console.error('❌ Erro salvar imagens:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN - UPLOAD
// ============================================
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.post('/api/admin/upload', verificarToken, verificarAdmin, upload.single('imagem'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    console.log('📸 Recebendo upload:', req.file.originalname, req.file.size + ' bytes');

    const base64 = req.file.buffer.toString('base64');
    const url = `data:${req.file.mimetype};base64,${base64}`;
    
    res.json({ 
      success: true, 
      url: url,
      message: 'Imagem recebida com sucesso!'
    });

  } catch (error) {
    console.error('❌ Erro no upload:', error);
    res.status(500).json({ error: 'Erro ao processar upload: ' + error.message });
  }
});

// ============================================
// ADMIN - ABANDONOS
// ============================================
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

app.post('/api/admin/notificar-whatsapp', verificarToken, verificarAdmin, function(req, res) {
  const { sessionId } = req.body;
  
  const abandono = abandonos.find(a => a.sessionId === sessionId);
  if (!abandono) {
    return res.status(404).json({ error: "Abandono não encontrado" });
  }
  
  if (!abandono.usuario?.telefone || abandono.usuario.telefone === 'Não informado') {
    return res.status(400).json({ error: "Usuário não tem telefone cadastrado" });
  }
  
  let mensagem = `🛍️ *JM Store - Carrinho Abandonado*\n\n` +
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
// VISITANTES
// ============================================
app.post('/api/visitantes/registrar', async function(req, res) {
  try {
    const { sessionId, pagina, userAgent, localizacao } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || '0.0.0.0';
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId é obrigatório' });
    }

    const { data, error } = await supabase
      .from('visitantes')
      .insert([{
        session_id: sessionId,
        ip: ip,
        user_agent: userAgent || 'Desconhecido',
        pagina: pagina || '/',
        pais: localizacao?.country || null,
        regiao: localizacao?.region || null,
        cidade: localizacao?.city || null,
        data_visita: new Date().toISOString()
      }])
      .select();

    if (error) {
      console.error('❌ Erro ao inserir visitante:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json({ msg: 'Visita registrada', data: data[0] });
  } catch (error) {
    console.error('❌ Erro ao registrar visita:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/visitantes', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { count: totalVisitas, error: errTotal } = await supabase
      .from('visitantes')
      .select('*', { count: 'exact', head: true });

    if (errTotal) throw errTotal;

    const hoje = new Date().toISOString().split('T')[0];
    const { count: visitasHoje, error: errHoje } = await supabase
      .from('visitantes')
      .select('*', { count: 'exact', head: true })
      .gte('data_visita', hoje);

    if (errHoje) throw errHoje;

    const { data: visitantesUnicos, error: errUnicos } = await supabase
      .from('visitantes')
      .select('session_id');

    if (errUnicos) throw errUnicos;

    const unicos = visitantesUnicos ? [...new Set(visitantesUnicos.map(v => v.session_id))] : [];

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
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MARKETING
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
// PEDIDOS E RASTREIO
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
  try {
    const { data, error } = await supabase
      .from('pedidos')
      .select('codigo_rastreio, transportadora, status, status_atualizado_em, historico_rastreio')
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuario.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Pedido não encontrado' });
      }
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Erro ao buscar rastreio:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/pedidos/:id/rastreio', verificarToken, verificarAdmin, async function(req, res) {
  try {
    const { codigo_rastreio, transportadora, status, observacao } = req.body;
    const pedidoId = req.params.id;

    const { data: pedido, error: errBusca } = await supabase
      .from('pedidos')
      .select('historico_rastreio, status')
      .eq('id', pedidoId)
      .single();

    if (errBusca) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

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
    res.json({ msg: 'Rastreio atualizado', data: data[0] });
  } catch (error) {
    console.error('❌ Erro ao atualizar rastreio:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GEOLOCALIZAÇÃO
// ============================================
app.get('/api/geolocalizacao', async function(req, res) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || '0.0.0.0';
    const ipClean = ip.replace('::ffff:', '');
    
    if (ipClean === '127.0.0.1' || ipClean === 'localhost' || ipClean.startsWith('192.168.') || ipClean.startsWith('10.')) {
      return res.json({
        ip: ipClean,
        country: 'AO',
        country_name: 'Angola',
        region: 'Luanda',
        city: 'Luanda',
        isp: 'Localhost'
      });
    }
    
    const response = await fetch(`http://ip-api.com/json/${ipClean}?fields=status,country,countryCode,regionName,city,isp,lat,lon`);
    const data = await response.json();
    
    if (data.status === 'success') {
      res.json({
        ip: ipClean,
        country: data.countryCode,
        country_name: data.country,
        region: data.regionName,
        city: data.city,
        isp: data.isp,
        lat: data.lat,
        lon: data.lon
      });
    } else {
      res.json({
        ip: ipClean,
        country: 'Desconhecido',
        region: 'Desconhecido',
        city: 'Desconhecido'
      });
    }
  } catch (error) {
    console.error('❌ Erro na geolocalização:', error);
    res.json({
      ip: 'Erro',
      country: 'Erro',
      region: 'Erro',
      city: 'Erro'
    });
  }
});

// ============================================
// INICIAR SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('🚀 JM Server rodando na porta ' + PORT);
  console.log('📧 Brevo API:', emailConfigurado ? '✅ Configurado' : '❌ Não configurado');
  console.log('📊 Teste: https://jm-server.onrender.com/api/test');
  console.log('📧 Teste Email: https://jm-server.onrender.com/api/test-email');
});
