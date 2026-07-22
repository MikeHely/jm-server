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
app.use(cors());
app.use(express.json());

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

// ===== RASTREIO DE ABANDONOS =====
const abandonos = [];
let contadorRegistros = 0;
const LIMITE_NOTIFICACAO = 5;

// ===== MIDDLEWARES =====
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
    return res.status(403).json({ error: "Acesso negado" });
  }
  next();
}

// ===== CONFIGURAÇÃO UPLOAD =====
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    const tipos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (tipos.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo não suportado'), false);
    }
  }
});

// ===== FUNÇÃO PARA ENVIAR EMAIL =====
async function enviarEmailNotificacao(novosRegistros) {
  if (!transporter) {
    console.log('⚠️ Email não enviado: transporte não configurado');
    return false;
  }

  try {
    const abandonosLista = novosRegistros.filter(function(r) { return r.status === 'abandonado'; });
    const finalizadosLista = novosRegistros.filter(function(r) { return r.status === 'finalizado'; });
    
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
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th { background: #1E3A8A; color: white; padding: 8px; text-align: left; font-size: 12px; }
          td { padding: 8px; border-bottom: 1px solid #ddd; font-size: 13px; }
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
            <li>💰 Total em vendas potenciais: ${finalizadosLista.reduce(function(s, r) { return s + (r.total || 0); }, 0).toLocaleString('pt-PT')} KZ</li>
          </ul>
    `;
    
    if (abandonosLista.length > 0) {
      html += `<h3 style="color:#92400E; margin-top:20px;">🛒 ABANDONOS (${abandonosLista.length})</h3>`;
      for (var a = 0; a < abandonosLista.length; a++) {
        var ab = abandonosLista[a];
        html += `
          <div class="card card-abandono">
            <div style="display:flex; justify-content:space-between;">
              <div>
                <strong>${ab.usuario && ab.usuario.nome ? ab.usuario.nome : 'Visitante'}</strong>
                <span style="display:block; font-size:13px; color:#666;">
                  📧 ${ab.usuario && ab.usuario.email ? ab.usuario.email : 'Não informado'} | 📱 ${ab.usuario && ab.usuario.telefone ? ab.usuario.telefone : 'Não informado'}
                </span>
              </div>
              <div>
                <span class="status status-abandono">🛒 Abandonado</span>
                <span style="display:block; font-weight:bold; color:#92400E;">💰 ${(ab.total || 0).toLocaleString('pt-PT')} KZ</span>
              </div>
            </div>
            <details>
              <summary style="cursor:pointer; font-size:13px; color:#1E3A8A;">Ver itens</summary>
        `;
        if (ab.itens && ab.itens.length > 0) {
          for (var i = 0; i < ab.itens.length; i++) {
            var item = ab.itens[i];
            html += `
              <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                <span>${item.nome}</span>
                <span>x${item.quantidade}</span>
                <span style="margin-left:auto;">${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ</span>
              </div>
            `;
          }
        } else {
          html += '<p style="color:#999;">Sem itens</p>';
        }
        html += `
            </details>
          </div>
        `;
      }
    }
    
    if (finalizadosLista.length > 0) {
      html += `<h3 style="color:#065F46; margin-top:20px;">✅ FINALIZADOS (${finalizadosLista.length})</h3>`;
      for (var f = 0; f < finalizadosLista.length; f++) {
        var fin = finalizadosLista[f];
        html += `
          <div class="card card-finalizado">
            <div style="display:flex; justify-content:space-between;">
              <div>
                <strong>${fin.usuario && fin.usuario.nome ? fin.usuario.nome : 'Visitante'}</strong>
                <span style="display:block; font-size:13px; color:#666;">
                  📧 ${fin.usuario && fin.usuario.email ? fin.usuario.email : 'Não informado'} | 📱 ${fin.usuario && fin.usuario.telefone ? fin.usuario.telefone : 'Não informado'}
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
        `;
        if (fin.itens && fin.itens.length > 0) {
          for (var j = 0; j < fin.itens.length; j++) {
            var item2 = fin.itens[j];
            html += `
              <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                <span>${item2.nome}</span>
                <span>x${item2.quantidade}</span>
                <span style="margin-left:auto;">${(item2.preco * item2.quantidade).toLocaleString('pt-PT')} KZ</span>
              </div>
            `;
          }
        } else {
          html += '<p style="color:#999;">Sem itens</p>';
        }
        html += `
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
      subject: '📊 JM Store - ' + novosRegistros.length + ' novos registros!',
      html: html
    });
    
    console.log('📧 Email enviado com ' + novosRegistros.length + ' registros');
    return true;
  } catch (error) {
    console.error('❌ Erro ao enviar email:', error);
    return false;
  }
}

// ===== ROTAS PÚBLICAS =====

// Produtos públicos (apenas visíveis)
app.get('/api/produtos', async function(req, res) {
  const { data, error } = await supabase
    .from('produtos')
    .select('*')
    .eq('visivel', true)
    .order('id');
  if (error) return res.status(500).json({ error: error });
  res.json(data);
});

// Categorias
app.get('/api/categorias', async function(req, res) {
  const { data, error } = await supabase
    .from('produtos')
    .select('categoria')
    .eq('visivel', true)
    .order('categoria');
  if (error) return res.status(500).json({ error: error });
  var categorias = [];
  var seen = {};
  for (var i = 0; i < data.length; i++) {
    var cat = data[i].categoria;
    if (!seen[cat]) {
      seen[cat] = true;
      categorias.push(cat);
    }
  }
  res.json(categorias);
});

// ===== USUÁRIOS =====

// Registro completo
app.post('/api/register', async function(req, res) {
  var email = req.body.email;
  var password = req.body.password;
  var nome = req.body.nome;
  var telefone = req.body.telefone;
  var regiao = req.body.regiao;
  
  if (!email || !password || !nome || !telefone) {
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
  
  var hash = await bcrypt.hash(password, 10);
  
  const { data, error } = await supabase
    .from('usuarios')
    .insert([{ 
      email: email, 
      senha: hash, 
      nome: nome, 
      telefone: telefone, 
      regiao: regiao,
      is_admin: false,
      data_cadastro: new Date().toISOString()
    }])
    .select();
  
  if (error) {
    console.error('Erro registro:', error);
    return res.status(400).json({ error: "Erro ao cadastrar" });
  }
  
  res.json({ 
    msg: "Usuário criado com sucesso!",
    user: { id: data[0].id, email: email, nome: nome }
  });
});

// Login
app.post('/api/login', async function(req, res) {
  var email = req.body.email;
  var senha = req.body.senha;
  
  const { data } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .single();
  
  if (!data) {
    return res.status(401).json({ error: "Email ou senha inválidos" });
  }
  
  var senhaCorreta = await bcrypt.compare(senha, data.senha);
  if (!senhaCorreta) {
    return res.status(401).json({ error: "Email ou senha inválidos" });
  }

  var usuario = { 
    id: data.id, 
    email: data.email, 
    nome: data.nome,
    telefone: data.telefone,
    regiao: data.regiao,
    is_admin: !!data.is_admin 
  };
  
  var token = jwt.sign(usuario, JWT_SECRET, { expiresIn: '7d' });

  res.json({ msg: "Logado", user: usuario, token: token });
});

// Buscar perfil
app.get('/api/usuario/perfil', verificarToken, async function(req, res) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, email, nome, telefone, regiao, is_admin, data_cadastro')
    .eq('id', req.usuario.id)
    .single();
  
  if (error) return res.status(500).json({ error: error });
  res.json(data);
});

// Atualizar perfil
app.put('/api/usuario/perfil', verificarToken, async function(req, res) {
  var nome = req.body.nome;
  var telefone = req.body.telefone;
  var regiao = req.body.regiao;
  
  const { data, error } = await supabase
    .from('usuarios')
    .update({ nome: nome, telefone: telefone, regiao: regiao })
    .eq('id', req.usuario.id)
    .select();
  
  if (error) return res.status(500).json({ error: error });
  res.json(data[0]);
});

// ===== CARRINHO =====

// Salvar carrinho
app.post('/api/carrinho', verificarToken, async function(req, res) {
  var itens = req.body.itens;
  var usuario_id = req.usuario.id;
  
  if (!itens || !Array.isArray(itens)) {
    return res.status(400).json({ error: "Itens inválidos" });
  }
  
  await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuario_id);
  
  var itensParaSalvar = [];
  for (var i = 0; i < itens.length; i++) {
    itensParaSalvar.push({
      usuario_id: usuario_id,
      produto_id: itens[i].id,
      quantidade: itens[i].quantidade
    });
  }
  
  const { error } = await supabase
    .from('carrinho')
    .insert(itensParaSalvar);
  
  if (error) {
    console.error('Erro salvar carrinho:', error);
    return res.status(500).json({ error: "Erro ao salvar carrinho" });
  }
  
  res.json({ msg: "Carrinho salvo" });
});

// Buscar carrinho
app.get('/api/carrinho', verificarToken, async function(req, res) {
  var usuario_id = req.usuario.id;
  
  const { data, error } = await supabase
    .from('carrinho')
    .select('quantidade, produtos(*)')
    .eq('usuario_id', usuario_id);
  
  if (error) {
    console.error('Erro buscar carrinho:', error);
    return res.status(500).json({ error: "Erro ao buscar carrinho" });
  }
  
  var itens = [];
  for (var i = 0; i < data.length; i++) {
    var item = data[i].produtos;
    item.quantidade = data[i].quantidade;
    itens.push(item);
  }
  
  res.json(itens);
});

// ===== PEDIDOS =====

app.get('/api/pedidos', verificarToken, async function(req, res) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, itens_pedido (quantidade, preco_unitario, produtos (*))')
    .eq('usuario_id', req.usuario.id)
    .order('data_pedido', { ascending: false });
  
  if (error) {
    console.error('Erro buscar pedidos:', error);
    return res.status(500).json({ error: "Erro ao buscar pedidos" });
  }
  
  res.json(data);
});

// ===== RASTREIO DE ABANDONO =====

app.post('/api/checkout/registrar', async function(req, res) {
  var sessionId = req.body.sessionId;
  var usuario = req.body.usuario;
  var itens = req.body.itens;
  
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId é obrigatório" });
  }
  
  var total = 0;
  if (itens) {
    for (var i = 0; i < itens.length; i++) {
      total = total + (itens[i].preco || 0) * (itens[i].quantidade || 1);
    }
  }
  
  var existente = null;
  for (var j = 0; j < abandonos.length; j++) {
    if (abandonos[j].sessionId === sessionId) {
      existente = abandonos[j];
      break;
    }
  }
  
  var registro = {
    sessionId: sessionId,
    usuario: usuario || { nome: 'Visitante', email: 'Não informado', telefone: 'Não informado' },
    itens: itens || [],
    total: total,
    step: 'checkout_aberto',
    timestamp: new Date().toISOString(),
    status: 'abandonado',
    tentativas: 0,
    ultimo_contato: null
  };
  
  if (existente) {
    existente.usuario = registro.usuario;
    existente.itens = registro.itens;
    existente.total = registro.total;
    existente.step = registro.step;
    existente.timestamp = registro.timestamp;
    existente.status = registro.status;
  } else {
    abandonos.push(registro);
    contadorRegistros = contadorRegistros + 1;
  }
  
  res.json({ msg: "Checkout registrado" });
});

app.post('/api/checkout/step', async function(req, res) {
  var sessionId = req.body.sessionId;
  var step = req.body.step;
  var dados = req.body.dados;
  
  var registro = null;
  for (var i = 0; i < abandonos.length; i++) {
    if (abandonos[i].sessionId === sessionId) {
      registro = abandonos[i];
      break;
    }
  }
  
  if (registro) {
    registro.step = step;
    if (dados) {
      if (!registro.usuario) registro.usuario = {};
      if (dados.nome) registro.usuario.nome = dados.nome;
      if (dados.email) registro.usuario.email = dados.email;
      if (dados.telefone) registro.usuario.telefone = dados.telefone;
      if (dados.regiao) registro.usuario.regiao = dados.regiao;
    }
    if (step === 'finalizado') {
      registro.status = 'finalizado';
      registro.data_finalizacao = new Date().toISOString();
      contadorRegistros = contadorRegistros + 1;
    }
  }
  
  res.json({ msg: "Step atualizado" });
});

// ===== ADMIN - ABANDONOS =====

app.get('/api/admin/abandonos', verificarToken, verificarAdmin, function(req, res) {
  var abandonados = [];
  var finalizados = [];
  
  for (var i = 0; i < abandonos.length; i++) {
    if (abandonos[i].status === 'abandonado') {
      abandonados.push(abandonos[i]);
    } else if (abandonos[i].status === 'finalizado') {
      finalizados.push(abandonos[i]);
    }
  }
  
  res.json({
    abandonos: abandonados,
    finalizados: finalizados,
    total: abandonos.length,
    total_abandonos: abandonados.length,
    total_finalizados: finalizados.length
  });
});

app.delete('/api/admin/abandonos/:sessionId', verificarToken, verificarAdmin, function(req, res) {
  var sessionId = req.params.sessionId;
  var index = -1;
  
  for (var i = 0; i < abandonos.length; i++) {
    if (abandonos[i].sessionId === sessionId) {
      index = i;
      break;
    }
  }
  
  if (index === -1) {
    return res.status(404).json({ error: "Registro não encontrado" });
  }
  
  abandonos.splice(index, 1);
  res.json({ msg: "Registro excluído com sucesso" });
});

app.delete('/api/admin/abandonos/limpar', verificarToken, verificarAdmin, function(req, res) {
  var tipo = req.body.tipo;
  
  if (tipo === 'todos') {
    abandonos.length = 0;
    contadorRegistros = 0;
  } else if (tipo === 'abandonados') {
    var finalizados = [];
    for (var i = 0; i < abandonos.length; i++) {
      if (abandonos[i].status === 'finalizado') {
        finalizados.push(abandonos[i]);
      }
    }
    abandonos.length = 0;
    for (var j = 0; j < finalizados.length; j++) {
      abandonos.push(finalizados[j]);
    }
  } else if (tipo === 'finalizados') {
    var abandonados = [];
    for (var k = 0; k < abandonos.length; k++) {
      if (abandonos[k].status === 'abandonado') {
        abandonados.push(abandonos[k]);
      }
    }
    abandonos.length = 0;
    for (var l = 0; l < abandonados.length; l++) {
      abandonos.push(abandonados[l]);
    }
  }
  
  res.json({ msg: "Registros limpos com sucesso" });
});

app.post('/api/admin/notificar-whatsapp', verificarToken, verificarAdmin, function(req, res) {
  var sessionId = req.body.sessionId;
  var mensagemPersonalizada = req.body.mensagemPersonalizada;
  
  var abandono = null;
  for (var i = 0; i < abandonos.length; i++) {
    if (abandonos[i].sessionId === sessionId) {
      abandono = abandonos[i];
      break;
    }
  }
  
  if (!abandono) {
    return res.status(404).json({ error: "Abandono não encontrado" });
  }
  
  if (!abandono.usuario || !abandono.usuario.telefone || abandono.usuario.telefone === 'Não informado') {
    return res.status(400).json({ error: "Usuário não tem telefone cadastrado" });
  }
  
  var mensagem = mensagemPersonalizada || 
    '🛍️ *JM Store - Carrinho Abandonado*\n\n' +
    'Olá ' + (abandono.usuario.nome || 'cliente') + '! 👋\n\n' +
    'Vimos que você deixou alguns produtos no carrinho. Quer finalizar sua compra?\n\n' +
    '📦 *Itens:*\n';
  
  if (abandono.itens) {
    for (var j = 0; j < abandono.itens.length; j++) {
      var item = abandono.itens[j];
      mensagem = mensagem + '- ' + item.nome + ' x' + item.quantidade + ': ' + (item.preco * item.quantidade).toLocaleString('pt-PT') + ' KZ\n';
    }
  }
  
  mensagem = mensagem + '\n💰 *Total: ' + (abandono.total || 0).toLocaleString('pt-PT') + ' KZ*\n\n';
  mensagem = mensagem + 'Acesse: ' + (process.env.STORE_URL || 'https://jm-store.vercel.app') + '\n\n';
  mensagem = mensagem + '*Responda esta mensagem para finalizar seu pedido!* 🚀';
  
  var link = 'https://wa.me/' + abandono.usuario.telefone + '?text=' + encodeURIComponent(mensagem);
  
  abandono.tentativas = (abandono.tentativas || 0) + 1;
  abandono.ultimo_contato = new Date().toISOString();
  
  res.json({ 
    success: true, 
    link: link,
    mensagem: mensagem,
    telefone: abandono.usuario.telefone
  });
});

// ===== ADMIN - PRODUTOS =====

app.get('/api/admin/produtos', verificarToken, verificarAdmin, async function(req, res) {
  const { data, error } = await supabase
    .from('produtos')
    .select('*')
    .order('id');
  if (error) return res.status(500).json({ error: error });
  res.json(data);
});

app.post('/api/admin/produtos', verificarToken, verificarAdmin, async function(req, res) {
  const { data, error } = await supabase
    .from('produtos')
    .insert([{ 
      nome: req.body.nome, 
      preco: req.body.preco, 
      categoria: req.body.categoria, 
      imagem: req.body.imagem, 
      visivel: true 
    }])
    .select();
  if (error) return res.status(500).json({ error: error });
  res.json(data[0]);
});

app.put('/api/admin/produtos/:id', verificarToken, verificarAdmin, async function(req, res) {
  const { data, error } = await supabase
    .from('produtos')
    .update({ 
      nome: req.body.nome, 
      preco: req.body.preco, 
      categoria: req.body.categoria, 
      imagem: req.body.imagem 
    })
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error });
  res.json(data[0]);
});

app.patch('/api/admin/produtos/:id/visibilidade', verificarToken, verificarAdmin, async function(req, res) {
  var visivel = req.body.visivel;
  if (typeof visivel !== 'boolean') {
    return res.status(400).json({ error: 'visivel deve ser boolean' });
  }
  
  const { data, error } = await supabase
    .from('produtos')
    .update({ visivel: visivel })
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error: error });
  res.json(data[0]);
});

app.delete('/api/admin/produtos/:id', verificarToken, verificarAdmin, async function(req, res) {
  const { error } = await supabase
    .from('produtos')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error });
  res.json({ msg: "Produto deletado" });
});

// ===== UPLOAD DE IMAGENS =====

app.post('/api/admin/upload', verificarToken, verificarAdmin, upload.single('imagem'), async function(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem' });
    }

    var buffer = await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    var id = ++contadorImagens;
    var nome = 'img_' + id + '_' + Date.now() + '.jpg';
    
    cacheImagens.set(id, {
      buffer: buffer,
      mimeType: 'image/jpeg',
      nome: nome,
      tamanho: buffer.length,
      criado_em: new Date().toISOString()
    });

    var url = req.protocol + '://' + req.get('host') + '/api/imagem/' + id;
    res.json({ success: true, url: url, id: id });
  } catch (error) {
    console.error('Erro upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload' });
  }
});

app.get('/api/imagem/:id', function(req, res) {
  var id = parseInt(req.params.id);
  var imagem = cacheImagens.get(id);
  if (!imagem) {
    return res.status(404).json({ error: 'Imagem não encontrada' });
  }
  res.set('Content-Type', imagem.mimeType);
  res.set('Cache-Control', 'public, max-age=31536000');
  res.send(imagem.buffer);
});

// ===== CHECKOUT =====

app.post('/api/checkout', verificarToken, async function(req, res) {
  var usuario_id = req.usuario.id;
  var itens = req.body.itens;
  var endereco = req.body.endereco;
  var metodo_pagamento = req.body.metodo_pagamento;
  var sessionId = req.body.sessionId;
  
  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Carrinho vazio" });
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nome, telefone, regiao, email')
    .eq('id', usuario_id)
    .single();

  var total = 0;
  for (var i = 0; i < itens.length; i++) {
    total = total + itens[i].preco * itens[i].quantidade;
  }
  
  const { data: pedido, error: erroPedido } = await supabase
    .from('pedidos')
    .insert([{ 
      usuario_id: usuario_id, 
      total: total, 
      status: 'Aguardando WhatsApp',
      endereco: endereco || (usuario ? usuario.regiao : 'Não informado'),
      metodo_pagamento: metodo_pagamento || 'WhatsApp',
      data_pedido: new Date().toISOString()
    }])
    .select()
    .single();
  
  if (erroPedido) {
    console.error('Erro criar pedido:', erroPedido);
    return res.status(500).json({ error: "Erro ao criar pedido" });
  }

  var itensPedido = [];
  for (var j = 0; j < itens.length; j++) {
    itensPedido.push({
      pedido_id: pedido.id,
      produto_id: itens[j].id,
      quantidade: itens[j].quantidade,
      preco_unitario: itens[j].preco
    });
  }
  
  await supabase
    .from('itens_pedido')
    .insert(itensPedido);

  await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuario_id);

  if (sessionId) {
    var abandono = null;
    for (var k = 0; k < abandonos.length; k++) {
      if (abandono[k] && abandonos[k].sessionId === sessionId) {
        abandono = abandonos[k];
        break;
      }
    }
    if (abandono) {
      abandono.status = 'finalizado';
      abandono.data_finalizacao = new Date().toISOString();
      abandono.pedido_id = pedido.id;
    }
  }

  // VERIFICA SE DEVE ENVIAR EMAIL
  if (abandonos.length > 0 && abandonos.length % LIMITE_NOTIFICACAO === 0) {
    var ultimosRegistros = abandonos.slice(-LIMITE_NOTIFICACAO);
    enviarEmailNotificacao(ultimosRegistros).catch(function(err) { console.error(err); });
  }

  // MENSAGEM WHATSAPP
  var msg = '*🛍️ NOVO PEDIDO JM STORE #' + pedido.id + '*\n\n';
  msg = msg + '👤 *Cliente:* ' + (usuario ? usuario.nome : 'Não informado') + '\n';
  msg = msg + '📧 *Email:* ' + (usuario ? usuario.email : 'Não informado') + '\n';
  msg = msg + '📱 *Telefone:* ' + (usuario ? usuario.telefone : 'Não informado') + '\n';
  msg = msg + '📍 *Região:* ' + (usuario ? usuario.regiao : 'Não informado') + '\n';
  msg = msg + '📦 *Endereço:* ' + (endereco || (usuario ? usuario.regiao : 'Não informado')) + '\n\n';
  msg = msg + '*📋 ITENS DO PEDIDO:*\n';
  
  for (var l = 0; l < itens.length; l++) {
    var item3 = itens[l];
    msg = msg + (l + 1) + '. ' + item3.nome + ' x' + item3.quantidade + ' = ' + (item3.preco * item3.quantidade).toLocaleString('pt-PT') + ' KZ\n';
  }
  
  msg = msg + '\n*💰 TOTAL: ' + total.toLocaleString('pt-PT') + ' KZ*';
  msg = msg + '\n💳 *Pagamento:* ' + (metodo_pagamento || 'WhatsApp');
  msg = msg + '\n\n🔗 *Pedido #' + pedido.id + '*';
  
  var link = 'https://wa.me/' + NUMERO_WHATSAPP_JM + '?text=' + encodeURIComponent(msg);
  
  res.json({ 
    link: link, 
    pedido_id: pedido.id,
    pedido: {
      id: pedido.id,
      total: total,
      status: pedido.status,
      data: pedido.data_pedido
    }
  });
});

// ===== DASHBOARD ADMIN =====

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
    
    var totalAbandonos = 0;
    var totalFinalizados = 0;
    for (var i = 0; i < abandonos.length; i++) {
      if (abandonos[i].status === 'abandonado') {
        totalAbandonos = totalAbandonos + 1;
      } else if (abandonos[i].status === 'finalizado') {
        totalFinalizados = totalFinalizados + 1;
      }
    }
    
    res.json({
      stats: {
        totalProdutos: totalProdutos || 0,
        totalPedidos: totalPedidos || 0,
        totalUsuarios: totalUsuarios || 0,
        totalAbandonos: totalAbandonos,
        totalFinalizados: totalFinalizados
      },
      pedidosRecentes: pedidosRecentes || []
    });
  } catch (error) {
    console.error('Erro dashboard:', error);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('🚀 JM Server rodando na porta ' + PORT);
  console.log('📊 API URL: http://localhost:' + PORT + '/api/produtos');
});
