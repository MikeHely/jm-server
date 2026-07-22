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
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
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
    const abandonosLista = novosRegistros.filter(r => r.status === 'abandonado');
    const finalizadosLista = novosRegistros.filter(r => r.status === 'finalizado');
    
    const html = `
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
            <li>💰 Total em vendas potenciais: ${finalizadosLista.reduce((s, r) => s + (r.total || 0), 0).toLocaleString('pt-PT')} KZ</li>
          </ul>
          
          ${abandonosLista.length > 0 ? `
            <h3 style="color:#92400E; margin-top:20px;">🛒 ABANDONOS (${abandonosLista.length})</h3>
            ${abandonosLista.map(a => `
              <div class="card card-abandono">
                <div style="display:flex; justify-content:space-between;">
                  <div>
                    <strong>${a.usuario?.nome || 'Visitante'}</strong>
                    <span style="display:block; font-size:13px; color:#666;">
                      📧 ${a.usuario?.email || 'Não informado'} | 📱 ${a.usuario?.telefone || 'Não informado'}
                    </span>
                  </div>
                  <div>
                    <span class="status status-abandono">🛒 Abandonado</span>
                    <span style="display:block; font-weight:bold; color:#92400E;">💰 ${a.total?.toLocaleString('pt-PT') || '0'} KZ</span>
                  </div>
                </div>
                <details>
                  <summary style="cursor:pointer; font-size:13px; color:#1E3A8A;">Ver itens</summary>
                  ${a.itens?.map(item => `
                    <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                      <span>${item.nome}</span>
                      <span>x${item.quantidade}</span>
                      <span style="margin-left:auto;">${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ</span>
                    </div>
                  `).join('') || '<p style="color:#999;">Sem itens</p>'}
                </details>
              </div>
            `).join('')}
          ` : ''}
          
          ${finalizadosLista.length > 0 ? `
            <h3 style="color:#065F46; margin-top:20px;">✅ FINALIZADOS (${finalizadosLista.length})</h3>
            ${finalizadosLista.map(a => `
              <div class="card card-finalizado">
                <div style="display:flex; justify-content:space-between;">
                  <div>
                    <strong>${a.usuario?.nome || 'Visitante'}</strong>
                    <span style="display:block; font-size:13px; color:#666;">
                      📧 ${a.usuario?.email || 'Não informado'} | 📱 ${a.usuario?.telefone || 'Não informado'}
                    </span>
                    <span style="font-size:12px; color:#999;">🕐 ${new Date(a.timestamp).toLocaleString('pt-PT')}</span>
                  </div>
                  <div>
                    <span class="status status-finalizado">✅ Finalizado</span>
                    <span style="display:block; font-weight:bold; color:#16A34A;">💰 ${a.total?.toLocaleString('pt-PT') || '0'} KZ</span>
                    ${a.pedido_id ? `<span style="display:block; font-size:12px; color:#3B82F6;">📋 Pedido #${a.pedido_id}</span>` : ''}
                  </div>
                </div>
                <details>
                  <summary style="cursor:pointer; font-size:13px; color:#1E3A8A;">Ver itens</summary>
                  ${a.itens?.map(item => `
                    <div style="display:flex; gap:10px; padding:5px 0; font-size:13px; border-bottom:1px solid #f0f0f0;">
                      <span>${item.nome}</span>
                      <span>x${item.quantidade}</span>
                      <span style="margin-left:auto;">${(item.preco * item.quantidade).toLocaleString('pt-PT')} KZ</span>
                    </div>
                  `).join('') || '<p style="color:#999;">Sem itens</p>'}
                </details>
              </div>
            `).join('')}
          ` : ''}
          
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

// ===== ROTAS PÚBLICAS =====

// Produtos públicos (apenas visíveis)
app.get('/api/produtos', async (req, res) => {
  const { data, error } = await supabase
    .from('produtos')
    .select('*')
    .eq('visivel', true)
    .order('id');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Categorias
app.get('/api/categorias', async (req, res) => {
  const { data, error } = await supabase
    .from('produtos')
    .select('categoria')
    .eq('visivel', true)
    .order('categoria');
  if (error) return res.status(500).json({ error });
  const categorias = [...new Set(data.map(p => p.categoria))];
  res.json(categorias);
});

// ===== USUÁRIOS =====

// Registro completo
app.post('/api/register', async (req, res) => {
  const { email, password, nome, telefone, regiao } = req.body;
  
  if (!email || !password || !nome || !telefone) {
    return res.status(400).json({ error: "Todos os campos são obrigatórios" });
  }
  
  // Verifica se email já existe
  const { data: existing } = await supabase
    .from('usuarios')
    .select('id')
    .eq('email', email)
    .single();
  
  if (existing) {
    return res.status(400).json({ error: "Email já cadastrado" });
  }
  
  const hash = await bcrypt.hash(password, 10);
  
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
  
  if (error) {
    console.error('Erro registro:', error);
    return res.status(400).json({ error: "Erro ao cadastrar" });
  }
  
  res.json({ 
    msg: "Usuário criado com sucesso!",
    user: { id: data[0].id, email, nome }
  });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, senha } = req.body;
  
  const { data } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .single();
  
  if (!data) {
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

  res.json({ msg: "Logado", user: usuario, token });
});

// Buscar perfil
app.get('/api/usuario/perfil', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, email, nome, telefone, regiao, is_admin, data_cadastro')
    .eq('id', req.usuario.id)
    .single();
  
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Atualizar perfil
app.put('/api/usuario/perfil', verificarToken, async (req, res) => {
  const { nome, telefone, regiao } = req.body;
  
  const { data, error } = await supabase
    .from('usuarios')
    .update({ nome, telefone, regiao })
    .eq('id', req.usuario.id)
    .select();
  
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// ===== CARRINHO =====

// Salvar carrinho
app.post('/api/carrinho', verificarToken, async (req, res) => {
  const { itens } = req.body;
  const usuario_id = req.usuario.id;
  
  if (!itens || !Array.isArray(itens)) {
    return res.status(400).json({ error: "Itens inválidos" });
  }
  
  // Remove carrinho antigo
  await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuario_id);
  
  // Insere novos itens
  const itensParaSalvar = itens.map(item => ({
    usuario_id,
    produto_id: item.id,
    quantidade: item.quantidade
  }));
  
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
app.get('/api/carrinho', verificarToken, async (req, res) => {
  const usuario_id = req.usuario.id;
  
  const { data, error } = await supabase
    .from('carrinho')
    .select(`
      quantidade,
      produtos (*)
    `)
    .eq('usuario_id', usuario_id);
  
  if (error) {
    console.error('Erro buscar carrinho:', error);
    return res.status(500).json({ error: "Erro ao buscar carrinho" });
  }
  
  const itens = data.map(item => ({
    ...item.produtos,
    quantidade: item.quantidade
  }));
  
  res.json(itens);
});

// ===== PEDIDOS =====

app.get('/api/pedidos', verificarToken, async (req, res) => {
  const { data, error } = await supabase
    .from('pedidos')
    .select(`
      *,
      itens_pedido (
        quantidade,
        preco_unitario,
        produtos (*)
      )
    `)
    .eq('usuario_id', req.usuario.id)
    .order('data_pedido', { ascending: false });
  
  if (error) {
    console.error('Erro buscar pedidos:', error);
    return res.status(500).json({ error: "Erro ao buscar pedidos" });
  }
  
  res.json(data);
});

// ===== RASTREIO DE ABANDONO =====

// Registrar início do checkout
app.post('/api/checkout/registrar', async (req, res) => {
  const { sessionId, usuario, itens } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId é obrigatório" });
  }
  
  const total = (itens || []).reduce((s, i) => s + (i.preco || 0) * (i.quantidade || 1), 0);
  
  // Verifica se já existe
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
});

// Atualizar step do checkout
app.post('/api/checkout/step', async (req, res) => {
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
      contadorRegistros++;
    }
  }
  
  res.json({ msg: "Step atualizado" });
});

// ===== ADMIN - ABANDONOS =====

// Listar todos os registros
app.get('/api/admin/abandonos', verificarToken, verificarAdmin, async (req, res) => {
  res.json({
    abandonos: abandonos.filter(a => a.status === 'abandonado'),
    finalizados: abandonos.filter(a => a.status === 'finalizado'),
    total: abandonos.length,
    total_abandonos: abandonos.filter(a => a.status === 'abandonado').length,
    total_finalizados: abandonos.filter(a => a.status === 'finalizado').length
  });
});

// Excluir abandono individual
app.delete('/api/admin/abandonos/:sessionId', verificarToken, verificarAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const index = abandonos.findIndex(a => a.sessionId === sessionId);
  
  if (index === -1) {
    return res.status(404).json({ error: "Registro não encontrado" });
  }
  
  abandonos.splice(index, 1);
  res.json({ msg: "Registro excluído com sucesso" });
});

// Limpar todos os abandonos
app.delete('/api/admin/abandonos/limpar', verificarToken, verificarAdmin, async (req, res) => {
  const { tipo } = req.body; // 'todos', 'abandonados', 'finalizados'
  
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

// Notificar cliente via WhatsApp
app.post('/api/admin/notificar-whatsapp', verificarToken, verificarAdmin, async (req, res) => {
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

// ===== ADMIN - PRODUTOS =====

// Todos os produtos (admin)
app.get('/api/admin/produtos', verificarToken, verificarAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('produtos')
    .select('*')
    .order('id');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Criar produto
app.post('/api/admin/produtos', verificarToken, verificarAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('produtos')
    .insert([{ ...req.body, visivel: true }])
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// Atualizar produto
app.put('/api/admin/produtos/:id', verificarToken, verificarAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('produtos')
    .update(req.body)
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// Alternar visibilidade
app.patch('/api/admin/produtos/:id/visibilidade', verificarToken, verificarAdmin, async (req, res) => {
  const { visivel } = req.body;
  if (typeof visivel !== 'boolean') {
    return res.status(400).json({ error: 'visivel deve ser boolean' });
  }
  
  const { data, error } = await supabase
    .from('produtos')
    .update({ visivel })
    .eq('id', req.params.id)
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// Deletar produto
app.delete('/api/admin/produtos/:id', verificarToken, verificarAdmin, async (req, res) => {
  const { error } = await supabase
    .from('produtos')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ msg: "Produto deletado" });
});

// ===== UPLOAD DE IMAGENS (CACHE EM MEMÓRIA) =====

app.post('/api/admin/upload', verificarToken, verificarAdmin, upload.single('imagem'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem' });
    }

    // Otimiza a imagem
    const buffer = await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'cover', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Gera ID único e salva em cache
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
    console.error('Erro upload:', error);
    res.status(500).json({ error: 'Erro ao fazer upload' });
  }
});

// Servir imagem do cache
app.get('/api/imagem/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const imagem = cacheImagens.get(id);
  if (!imagem) {
    return res.status(404).json({ error: 'Imagem não encontrada' });
  }
  res.set('Content-Type', imagem.mimeType);
  res.set('Cache-Control', 'public, max-age=31536000');
  res.send(imagem.buffer);
});

// ===== CHECKOUT =====

app.post('/api/checkout', verificarToken, async (req, res) => {
  const usuario_id = req.usuario.id;
  const { itens, endereco, metodo_pagamento, sessionId } = req.body;
  
  if (!itens || itens.length === 0) {
    return res.status(400).json({ error: "Carrinho vazio" });
  }

  // Busca dados do usuário
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nome, telefone, regiao, email')
    .eq('id', usuario_id)
    .single();

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  
  // Cria pedido
  const { data: pedido, error: erroPedido } = await supabase
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
  
  if (erroPedido) {
    console.error('Erro criar pedido:', erroPedido);
    return res.status(500).json({ error: "Erro ao criar pedido" });
  }

  // Salva itens do pedido
  const itensPedido = itens.map(i => ({
    pedido_id: pedido.id,
    produto_id: i.id,
    quantidade: i.quantidade,
    preco_unitario: i.preco
  }));
  
  await supabase
    .from('itens_pedido')
    .insert(itensPedido);

  // Limpa carrinho
  await supabase
    .from('carrinho')
    .delete()
    .eq('usuario_id', usuario_id);

  // Atualiza abandono se existir
  if (sessionId) {
    const abandono = abandonos.find(a => a.sessionId === sessionId);
    if (abandono) {
      abandono.status = 'finalizado';
      abandono.data_finalizacao = new Date().toISOString();
      abandono.pedido_id = pedido.id;
    }
  }

  // VERIFICA SE DEVE ENVIAR EMAIL (a cada 5 registros)
  const totalRegistros = abandonos.length;
  if (totalRegistros > 0 && totalRegistros % LIMITE_NOTIFICACAO === 0) {
    const ultimosRegistros = abandonos.slice(-LIMITE_NOTIFICACAO);
    enviarEmailNotificacao(ultimosRegistros).catch(console.error);
  }

  // MENSAGEM WHATSAPP
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
});

// ===== DASHBOARD ADMIN =====

app.get('/api/admin/dashboard', verificarToken, verificarAdmin, async (req, res) => {
  try {
    // Total de produtos
    const { count: totalProdutos } = await supabase
      .from('produtos')
      .select('*', { count: 'exact', head: true });
    
    // Total de pedidos
    const { count: totalPedidos } = await supabase
      .from('pedidos')
      .select('*', { count: 'exact', head: true });
    
    // Total de usuários
    const { count: totalUsuarios } = await supabase
      .from('usuarios')
      .select('*', { count: 'exact', head: true });
    
    // Pedidos recentes    const { data: pedidosRecentes } = await supabase
      .from('pedidos')
      .select(`
        *,
        usuarios (nome, email, telefone)
      `)
      .order('data_pedido', { ascending: false })
      .limit(5);
    
    // Estatísticas de abandonos
    const totalAbandonos = abandonos.filter(a => a.status === 'abandonado').length;
    const totalFinalizados = abandonos.filter(a => a.status === 'finalizado').length;
    
    res.json({
      stats: {
        totalProdutos,
        totalPedidos,
        totalUsuarios,
        totalAbandonos,
        totalFinalizados
      },
      pedidosRecentes
    });
  } catch (error) {
    console.error('Erro dashboard:', error);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 JM Server rodando na porta ${PORT}`);
  console.log(`📊 API URL: http://localhost:${PORT}/api/produtos`);
});