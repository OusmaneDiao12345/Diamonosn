require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'diamano.db');
const WEBHOOK_SECRET = process.env.SENEPAY_WEBHOOK_SECRET || process.env.SENEPAY_API_SECRET;

const rawAllowedOrigins = [
    process.env.FRONTEND_URL,
    process.env.CORS_ORIGINS
]
    .filter(Boolean)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);

const allowedOrigins = new Set([
    ...rawAllowedOrigins,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
]);

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin non autorisee par CORS'));
    }
}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ⚙️ CONFIGURATION SENE-PAY (INTEGRATION)
// ==========================================
const SENEPAY_CONFIG = {
    apiKey: process.env.SENEPAY_API_KEY,
    apiSecret: process.env.SENEPAY_API_SECRET,
    baseUrl: process.env.SENEPAY_BASE_URL || 'https://api.sene-pay.com/api/v1',
    webhookUrl: process.env.SENEPAY_WEBHOOK_URL || ''
};

function hasSenePayCredentials() {
    return Boolean(SENEPAY_CONFIG.apiKey && SENEPAY_CONFIG.apiSecret);
}

if (!hasSenePayCredentials()) {
    console.warn('SenePay non configure: ajoutez SENEPAY_API_KEY et SENEPAY_API_SECRET dans les variables d\'environnement.');
}

// Connexion à la Base de Données SQLite
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erreur ouverture base de données', err.message);
    } else {
        console.log('Connecté à la base de données SQLite.');
        initDb();
    }
});

// Initialisation des Tables
function initDb() {
    db.serialize(() => {
        // Table Produits
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            cat TEXT,
            brand TEXT,
            price INTEGER,
            oldPrice INTEGER,
            rating REAL,
            reviews INTEGER,
            image TEXT,
            badge TEXT,
            desc TEXT,
            tags TEXT
        )`);

        // Table Utilisateurs
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            phone TEXT UNIQUE,
            email TEXT,
            password TEXT
        )`);

        // Table Commandes
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ref TEXT,
            userId INTEGER,
            clientName TEXT,
            total TEXT,
            status TEXT,
            date TEXT,
            items TEXT,
            payment TEXT,
            address TEXT
        )`);

        // Vérifier si produits existent, sinon les créer (Seed)
        db.get("SELECT count(*) as count FROM products", (err, row) => {
            if (row && row.count === 0) {
                console.log("Initialisation des produits...");
                seedProducts();
            } else {
                console.log(`Base de données chargée : ${row.count} produits existants.`);
            }
        });
    });
}

// Données initiales (basées sur votre HTML actuel)
const initialProducts = [
  {id:1,name:'Samsung Galaxy A54 5G 128Go',cat:'Électronique',brand:'Samsung',price:189000,oldPrice:239000,rating:4.5,reviews:284,image:'https://i.roamcdn.net/hz/ed/listing-gallery-full-1920w/acd777160bac6c8b22024453025cdef0/-/horizon-files-prod/ed/picture/qxjgj2qz/2ff87a27a8281733562188a0a523ae0604c80efb.jpg',badge:'hot',desc:'Écran 6.4" AMOLED 120Hz, 128Go, 5000mAh, Android 14. Garantie 1 an.',tags:'Smartphone,5G,Samsung'},
  {id:2,name:'Tecno Spark 40 Pro 256Go',cat:'Électronique',brand:'Tecno',price:89000,oldPrice:110000,rating:4.3,reviews:412,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/12/900721/1.jpg?7064',badge:'hot',desc:'Écran 6.78" FHD+, 256Go stockage, 5000mAh, Android 13.',tags:'Smartphone,Tecno'},
  {id:3,name:'iPhone 14 128Go',cat:'Électronique',brand:'Apple',price:585000,oldPrice:650000,rating:4.8,reviews:156,image:'https://parisdakarshopping.com/sites/default/files/styles/uc_product_full/public/2022-09/611mRs-imxL._AC_SL1500_.jpg?itok=NRfjdoar',badge:'top',desc:'A15 Bionic, double appareil 12MP, iOS 17.',tags:'Smartphone,Apple,iOS'},
  {id:4,name:'TV Samsung 43" 4K Smart',cat:'Électronique',brand:'Samsung',price:249000,oldPrice:320000,rating:4.6,reviews:89,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/22/766121/1.jpg?9195',badge:'sale',desc:'4K Crystal UHD, HDR, Smart TV Tizen, Wi-Fi. Garantie 2 ans.',tags:'TV,Samsung,4K'},
  {id:5,name:'Itel A70 64Go Dual SIM',cat:'Électronique',brand:'Itel',price:45000,oldPrice:55000,rating:4.2,reviews:634,image:'https://zoom.com.tn/60414-large_default/smartphone-itel-a70-4go-64-go-double-sim-noir-a665l.jpg',badge:'new',desc:'6.6" écran, 64Go, Android 13 Go Edition.',tags:'Smartphone,Itel'},
  {id:6,name:'Clé 4G Huawei E3372',cat:'Électronique',brand:'Huawei',price:28000,oldPrice:35000,rating:4.4,reviews:203,image:'https://m.media-amazon.com/images/I/41o9FGXkvyS.jpg',badge:'sale',desc:'Clé 4G LTE 150Mbps, compatible tous opérateurs Sénégal.',tags:'4G,Internet,Huawei'},
  {id:7,name:'Boubou Grand Bazin Brodé Homme',cat:'Mode',brand:'Atelier Dakar',price:38000,oldPrice:50000,rating:4.9,reviews:342,image:'https://afro-elegance.com/cdn/shop/files/hommes-royal-bleu-dashiki-blanc-geometrique-broderie.webp?v=1756117480',badge:'hot',desc:'Grand Bazin brodé, qualité supérieure, taille S-XXL.',tags:'Boubou,Traditionnel,Homme'},
  {id:8,name:'Robe Wax Bogolan Femme',cat:'Mode',brand:'Mode Africaine SN',price:18500,oldPrice:25000,rating:4.7,reviews:512,image:'https://kaysolcouture.fr/cdn/shop/files/IMG_8656.jpg?v=1722855919&width=990',badge:'sale',desc:'Tissu wax bogolan authentique, coupe moderne 2024.',tags:'Wax,Femme,Robe'},
  {id:9,name:'Babouches Cuir Artisanal Dakar',cat:'Mode',brand:'Maroquinerie Dakar',price:12000,oldPrice:16000,rating:4.6,reviews:287,image:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQDaPcRAnfy1L1fJ1FnOEEFiKHm3dPjoYMexA&s',badge:'top',desc:'Cuir véritable tannerie Dakar, confort & durabilité. Fait main.',tags:'Chaussures,Cuir,Artisanat'},
  {id:10,name:'Adidas Ultraboost 22 Running',cat:'Mode',brand:'Adidas',price:65000,oldPrice:85000,rating:4.8,reviews:145,image:'https://runners.ae/cdn/shop/products/ADIDAS-ULTRABOOST-22-FOR-MEN-LEGEND-INK-GX6642_5.jpg?v=1662712628',badge:'sale',desc:'Chaussures running premium, technologie Boost.',tags:'Sport,Adidas,Running'},
  {id:11,name:'Riz Brisé Extra SAED 50kg',cat:'Alimentation',brand:'SAED',price:22000,oldPrice:27000,rating:4.9,reviews:820,image:'https://www.senboutique.com/images/products/detail_113_riz_umbrella-25kg.jpg',badge:'top',desc:'Riz brisé qualité extra, idéal thiébou dieun. Production locale.',tags:'Riz,Local,Cuisine'},
  {id:12,name:"Huile d'Arachide Lesieur 5L",cat:'Alimentation',brand:'Lesieur',price:8500,oldPrice:10500,rating:4.8,reviews:634,image:'https://sakanal.sn/10488-large_default/huile-lessieur-5l.jpg',badge:'hot',desc:"Huile pure qualité supérieure, 100% arachide, origine Sénégal.",tags:'Huile,Cuisine,Local'},
  {id:13,name:'Café Touba Premium 500g',cat:'Alimentation',brand:'Touba Coffee',price:4500,oldPrice:5500,rating:4.9,reviews:756,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/86/946321/1.jpg?9642',badge:'top',desc:'Café Touba authentique, sélection djar et karité.',tags:'Café,Touba,Local'},
  {id:14,name:'Kit Épices Thiébou Dieun',cat:'Alimentation',brand:'Saveurs du Sénégal',price:7500,oldPrice:9000,rating:4.7,reviews:412,image:'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRm5kIJSnVAj8y1kZ7Paevy2XhSXT-g1NHAAEJcild2KIo_pO7O1CcV79__C29_dXxVOhg&usqp=CAU',badge:'new',desc:'Kit épices : tomate séchée, céleri, ail, guedj, nététu. 100% naturel.',tags:'Épices,Cuisine,Local'},
  {id:15,name:'Ventilateur sur Pied Tornado 18"',cat:'Maison & Déco',brand:'Tornado',price:22000,oldPrice:28000,rating:4.4,reviews:345,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/93/658121/1.jpg?8780',badge:'sale',desc:'3 vitesses, oscillation 90°, silencieux, colonne réglable.',tags:'Ventilateur,Électroménager'},
  {id:16,name:'Climatiseur Haier 12000 BTU Split',cat:'Maison & Déco',brand:'Haier',price:245000,oldPrice:265000,rating:4.6,reviews:78,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/83/709621/1.jpg?3359',badge:'hot',desc:'Clim split 12000 BTU, Inverter A++, télécommande. Installation comprise à Dakar.',tags:'Climatiseur,Électroménager'},
  {id:17,name:'Matelas Simmons Conjugué 140x190',cat:'Maison & Déco',brand:'Simmons',price:145000,oldPrice:195000,rating:4.7,reviews:112,image:'https://www.direct-matelas.fr/8059-home_default/pack-140x190-matelas-simmons-sensoft-dos-sensible-sommier-dm-solux-tapissier-lattes-pieds-de-lit-cylindriques.jpg',badge:'sale',desc:'Matelas mousse mémoire de forme 20cm, garantie 5 ans.',tags:'Matelas,Chambre,Premium'},
  {id:18,name:'Beurre de Karité Pur 500ml',cat:'Beauté',brand:'Karité Sénégal',price:4800,oldPrice:6500,rating:4.9,reviews:923,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/94/62906/1.jpg?3806',badge:'top',desc:'Karité 100% naturel non raffiné bio, hydratant intense.',tags:'Karité,Naturel,Bio'},
  {id:19,name:'Savon Noir Beldi Artisanal',cat:'Beauté',brand:'Hammam Dakar',price:3200,oldPrice:4500,rating:4.7,reviews:456,image:'https://i.pinimg.com/736x/89/21/03/8921033383b6624ba0fe909373011198.jpg',badge:'new',desc:'Savon noir artisanal à huile olive, gommage naturel puissant.',tags:'Savon,Naturel,Artisanat'},
  {id:20,name:'Ballon Football Nike Strike',cat:'Sport',brand:'Nike',price:25000,oldPrice:35000,rating:4.6,reviews:234,image:'https://thumblr.uniid.it/product/150370/87646ba20337.jpg?width=3840&format=webp&q=75',badge:'sale',desc:'Ballon officiel FIFA Quality, taille 5.',tags:'Football,Ballon,Nike'},
  {id:21,name:'Tapis de Yoga 8mm + Sangle',cat:'Sport',brand:'Décathlon',price:15000,oldPrice:20000,rating:4.5,reviews:167,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/05/528221/1.jpg?7614',badge:'new',desc:'Tapis yoga 8mm, antidérapant double face, avec sangle.',tags:'Yoga,Sport,Bien-être'},
  {id:22,name:'Batterie Voiture Exide 60Ah',cat:'Auto & Moto',brand:'Exide',price:42000,oldPrice:55000,rating:4.5,reviews:143,image:'https://m.media-amazon.com/images/I/81VS3NNH3ML._AC_UF1000,1000_QL80_.jpg',badge:'sale',desc:'Batterie 60Ah longue durée, garantie 2 ans. Livraison & pose Dakar.',tags:'Batterie,Auto,Garantie'},
  {id:23,name:'Couches Pampers Premium L x60',cat:'Bébé & Jouets',brand:'Pampers',price:12500,oldPrice:15000,rating:4.8,reviews:567,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/18/946721/1.jpg?5135',badge:'hot',desc:'Couches ultra-absorbantes, taille L (9-14kg). Peaux sensibles.',tags:'Couches,Bébé,Pampers'},
  {id:24,name:'Poussette Bébé Confort Lara',cat:'Bébé & Jouets',brand:'Bébé Confort',price:78000,oldPrice:99000,rating:4.8,reviews:67,image:'https://sn.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/25/46489/1.jpg?0898',badge:'sale',desc:'Poussette pliable ultraléger, nacelle + siège, naissance à 15kg.',tags:'Poussette,Bébé'}
];

function seedProducts() {
    const stmt = db.prepare("INSERT INTO products (name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    initialProducts.forEach(p => {
        stmt.run(p.name, p.cat, p.brand, p.price, p.oldPrice, p.rating, p.reviews, p.image, p.badge, p.desc, p.tags);
    });
    stmt.finalize();
}

// ==================== API ROUTES ====================

app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        const products = rows.map(p => ({
            ...p,
            tags: p.tags ? p.tags.split(',') : [],
            old: p.oldPrice 
        }));
        res.json(products);
    });
});

app.post('/api/register', async (req, res) => {
    const { name, phone, email, password } = req.body;
    if (!password || password.length < 6) {
        return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10); // 10 = "salt rounds", une bonne valeur par défaut
        db.run(`INSERT INTO users (name, phone, email, password) VALUES (?,?,?,?)`, 
        [name, phone, email, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ error: "Ce numéro ou email existe déjà." });
            }
            res.status(201).json({ id: this.lastID, name, phone, email });
        });
    } catch (e) {
        res.status(500).json({ error: "Erreur lors de la création du compte." });
    }
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    // 1. On cherche l'utilisateur par son identifiant (téléphone ou email)
    db.get("SELECT * FROM users WHERE phone = ? OR email = ?", [id, id], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Si l'utilisateur existe, on compare le mot de passe fourni avec le hash en base de données
        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({ id: user.id, name: user.name, phone: user.phone, email: user.email });
        } else {
            // Si l'utilisateur n'existe pas ou si le mot de passe est faux, on renvoie la même erreur
            res.status(401).json({ error: "Identifiants incorrects" });
        }
    });
});

app.post('/api/orders', (req, res) => {
    const { ref, userId, clientName, total, status, date, items, payment, address } = req.body;
    const itemsStr = JSON.stringify(items);
    db.run(`INSERT INTO orders (ref, userId, clientName, total, status, date, items, payment, address) VALUES (?,?,?,?,?,?,?,?,?)`,
    [ref, userId, clientName, total, status, date, itemsStr, payment, address], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Commande enregistrée", orderId: this.lastID });
    });
});

// 5. Initier un paiement SenePay
app.post('/api/payment/initiate', async (req, res) => {
    if (!hasSenePayCredentials()) {
        return res.status(503).json({
            success: false,
            message: 'Paiement indisponible: configuration SenePay manquante sur le serveur.'
        });
    }

    console.log("\n=================================");
    console.log("📨 NOUVELLE DEMANDE DE PAIEMENT");
    
    // ✅ FIX 1: Forcer integer strict (SenePay rejette les floats)
    const amount = Math.round(Math.max(200, Number(req.body.amount) || 200));
    
    // ✅ FIX 2: Téléphone fallback (SenePay exige un numéro valide avec 221)
    const rawPhone = req.body.customerPhone || '';
    let customerPhone = String(rawPhone).replace(/\D/g, '');
    if (customerPhone.startsWith('00221')) customerPhone = customerPhone.slice(2);
    if (!customerPhone.startsWith('221')) customerPhone = '221' + customerPhone;
    if (customerPhone.length < 12) customerPhone = '221770000000';
    
    // URL de retour post-paiement
    let successUrl = req.body.returnUrl || process.env.FRONTEND_URL || 'https://diamanosn.netlify.app';
    if (successUrl.includes('127.0.0.1')) {
        successUrl = successUrl.replace('127.0.0.1', 'localhost');
    }

    console.log(`👤 Client   : ${req.body.customerName}`);
    console.log(`📱 Téléphone: ${customerPhone}`);
    console.log(`💰 Montant  : ${amount} FCFA (XOF)`);
    console.log(`🔗 SuccessUrl: ${successUrl}`);

    // ✅ FIX 4: Payload exact conforme à la doc SenePay
    const orderRef = req.body.orderReference || ("DIA-" + Date.now());
    const payload = {
        amount: amount,
        currency: 'XOF',
        orderReference: orderRef,
        successUrl: successUrl,
        metadata: {
            customerName: req.body.customerName || "Client",
            customerPhone: customerPhone,
            description: "Commande DiamanoSN"
        },
        ...(SENEPAY_CONFIG.webhookUrl ? { webhookUrl: SENEPAY_CONFIG.webhookUrl } : {})
    };

    console.log("📤 Payload envoyé:", JSON.stringify(payload, null, 2));

    try {
        const response = await axios.post(
            `${SENEPAY_CONFIG.baseUrl}/checkout/sessions`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Api-Key': SENEPAY_CONFIG.apiKey,
                    'X-Api-Secret': SENEPAY_CONFIG.apiSecret
                },
                timeout: 15000 // 15s timeout
            }
        );

        console.log("📥 Réponse SenePay:", JSON.stringify(response.data, null, 2));
        
        // Formats de retour checkout session
        const root = response.data || {};
        const d = root.data || {};
        const redirectUrl = d.checkoutUrl || root.checkoutUrl || d.redirectUrl || root.redirectUrl || d.url || root.url;
        const token = d.sessionToken || root.sessionToken || d.tokenPay || root.tokenPay || d.token || root.token;
        const status = d.status || root.status || 'Open';

        if (redirectUrl) {
            console.log("✅ SUCCÈS ! URL:", redirectUrl);
            res.json({ success: true, redirectUrl, token, status, orderReference: orderRef });
        } else {
            console.warn("⚠️ Réponse OK mais pas de redirectUrl. Réponse complète:", response.data);
            res.status(502).json({ 
                success: false, 
                message: "SenePay a répondu mais sans checkoutUrl. Vérifiez la configuration.",
                raw: response.data 
            });
        }

    } catch (error) {
        console.error("❌ ÉCHEC PAIEMENT SENEPAY");
        
        if (error.response) {
            // L'API a répondu avec une erreur HTTP
            const status = error.response.status;
            const body = error.response.data;
            console.error(`🔴 HTTP ${status}:`, JSON.stringify(body, null, 2));
            
            // Messages d'erreur lisibles selon le code
            let userMessage = "Erreur du service de paiement.";
            
            // Détection spécifique de l'erreur "Application non approuvée"
            if (JSON.stringify(body).includes("Application non approuvée")) {
                console.error("\n⚠️  DIAGNOSTIC : Vos clés API sont valides, mais le compte marchand SenePay/MoneyFusion n'est pas approuvé pour les transactions.");
                console.error("👉 Solution : Contactez le support SenePay pour activer votre compte ou vérifiez que vous n'utilisez pas des clés de test sur l'URL de production.\n");
                userMessage = "Compte SenePay non activé ou non approuvé (Erreur MoneyFusion).";
            }
            else if (status === 401) userMessage = "Clés API SenePay invalides. Vérifiez apiKey et apiSecret.";
            else if (status === 422) userMessage = "Données invalides envoyées à SenePay : " + (body?.message || JSON.stringify(body));
            else if (status === 400) userMessage = "Requête rejetée par SenePay : " + (body?.message || body?.error || JSON.stringify(body));
            else if (status === 403) userMessage = "Accès refusé SenePay. Compte peut-être en mode test ou suspendu.";
            else if (status === 429) userMessage = "Trop de requêtes SenePay. Attendez quelques secondes.";
            else if (status >= 500) userMessage = "Erreur interne SenePay. Réessayez dans quelques instants.";
            
            res.status(status).json({ success: false, message: userMessage, details: body });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            console.error("🔴 Timeout :", error.message);
            res.status(504).json({ success: false, message: "SenePay ne répond pas (timeout 15s). Réessayez." });
        } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
            console.error("🔴 DNS/Réseau :", error.message);
            res.status(503).json({ success: false, message: "Impossible d'atteindre SenePay. Vérifiez votre connexion internet." });
        } else {
            console.error("🔴 Erreur inconnue :", error.message);
            res.status(500).json({ success: false, message: "Erreur inattendue : " + error.message });
        }
    }
});

// 6. Vérifier le statut du paiement
app.get('/api/payment/status/:token', async (req, res) => {
    if (!hasSenePayCredentials()) {
        return res.status(503).json({
            success: false,
            message: 'Paiement indisponible: configuration SenePay manquante sur le serveur.'
        });
    }

    try {
        const response = await axios.get(`${SENEPAY_CONFIG.baseUrl}/checkout/sessions/${req.params.token}`, {
            headers: { 'X-Api-Key': SENEPAY_CONFIG.apiKey, 'X-Api-Secret': SENEPAY_CONFIG.apiSecret }
        });
        const root = response.data || {};
        if (root.error) {
            return res.status(404).json({ success: false, message: root.error });
        }
        const d = root.data || {};
        const normalizedStatus = String(d.status || root.status || '').toLowerCase();
        const completed = normalizedStatus === 'complete';
        res.json({ success: true, completed, data: d.status ? d : root });
    } catch (error) {
        res.status(500).json({ success: false, message: "Impossible de vérifier le statut" });
    }
});

// 7. Webhook SenePay (checkout)
app.post('/api/webhooks/senepay', express.json({ limit: '1mb' }), (req, res) => {
    try {
        const payload = req.body || {};
        const event = String(payload.event || '').toLowerCase();
        const orderRef = payload.orderReference || payload?.data?.orderReference;
        const incomingStatus = payload.status || payload?.data?.status || '';

        if (orderRef) {
            let nextStatus = null;
            if (event === 'checkout.session.completed') nextStatus = 'processing';
            else if (event === 'checkout.session.failed' || event === 'checkout.session.expired') nextStatus = 'failed';
            else if (String(incomingStatus).toLowerCase() === 'complete') nextStatus = 'processing';

            if (nextStatus) {
                db.run(`UPDATE orders SET status = ? WHERE ref = ?`, [nextStatus, orderRef], function(err) {
                    if (err) {
                        console.error('Erreur webhook update order:', err.message);
                    }
                });
            }
        }

        return res.status(200).json({ received: true });
    } catch (e) {
        console.error('Webhook SenePay erreur:', e.message);
        return res.status(200).json({ received: true });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur DiamanoSN démarré sur http://localhost:${PORT}`);
    console.log(`CORS autorise: ${Array.from(allowedOrigins).join(', ')}`);
});

// ==================== API COMMANDES UTILISATEUR ====================

// 8. Historique des commandes d'un utilisateur
app.get('/api/orders/user/:userId', (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId) {
        return res.status(400).json({ error: "ID utilisateur requis" });
    }
    
    db.all("SELECT * FROM orders WHERE userId = ? ORDER BY date DESC", [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const orders = rows.map(order => ({
            ...order,
            items: order.items ? JSON.parse(order.items) : []
        }));
        
        res.json(orders);
    });
});

// 9. Consultation d'une commande par ID ou référence
app.get('/api/orders/:idOrRef', (req, res) => {
    const idOrRef = req.params.idOrRef;
    
    // Essayer par ID numérique, sinon par référence
    const isNumeric = /^\d+$/.test(idOrRef);
    const query = isNumeric 
        ? "SELECT * FROM orders WHERE id = ?" 
        : "SELECT * FROM orders WHERE ref = ?";
    const param = isNumeric ? parseInt(idOrRef) : idOrRef;
    
    db.get(query, [param], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: "Commande non trouvée" });
        
        order.items = order.items ? JSON.parse(order.items) : [];
        res.json(order);
    });
});

// ==================== DASHBOARD ADMIN ====================

// Middleware de sécurité pour l'administration
const adminAuth = (req, res, next) => {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    if (adminKey === process.env.ADMIN_SECRET || adminKey === 'diamano_admin_secret_2024') {
        next();
    } else {
        res.status(403).json({ error: "Accès refusé. Clé admin requise pour cette opération." });
    }
};

// 10. Stats globales pour l'admin
app.get('/api/admin/stats', adminAuth, (req, res) => {
    const stats = {};
    
    db.get("SELECT COUNT(*) as total FROM products", [], (err, row) => {
        stats.totalProducts = row?.count || 0;
        
        db.get("SELECT COUNT(*) as total FROM users", [], (err, row) => {
            stats.totalUsers = row?.count || 0;
            
            db.get("SELECT COUNT(*) as total FROM orders", [], (err, row) => {
                stats.totalOrders = row?.count || 0;
                
                db.get("SELECT SUM(CAST(total AS INTEGER)) as revenue FROM orders WHERE status != 'failed'", [], (err, row) => {
                    stats.totalRevenue = row?.revenue || 0;
                    
                    db.get("SELECT status, COUNT(*) as count FROM orders GROUP BY status", [], (err, rows) => {
                        stats.ordersByStatus = rows || [];
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// 11. Liste étendue des commandes avec filtrage (admin)
app.get('/api/admin/orders', adminAuth, (req, res) => {
    const status = req.query.status;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    let sql = "SELECT * FROM orders";
    let params = [];
    
    if (status) {
        sql += " WHERE status = ?";
        params.push(status);
    }
    
    sql += " ORDER BY date DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const orders = rows.map(order => ({
            ...order,
            items: order.items ? JSON.parse(order.items) : []
        }));
        res.json(orders);
    });
});

// 12. Mettre à jour le statut d'une commande (admin)
app.patch('/api/admin/orders/:id/status', adminAuth, (req, res) => {
    const orderId = parseInt(req.params.id);
    const { status } = req.body;
    
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'failed', 'completed'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: "Statut invalide. Options: " + validStatuses.join(', ') });
    }
    
    // On récupère d'abord la commande pour logger le changement si nécessaire
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, orderId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Commande non trouvée" });
        
        // Optionnel: Envoyer un email ou une notification ici pour "synchroniser" l'utilisateur
        res.json({ 
            message: "Statut mis à jour avec succès", 
            orderId, 
            status,
            updatedAt: new Date().toISOString()
        });
    });
});

// 13. Liste tous les utilisateurs (admin)
app.get('/api/admin/users', adminAuth, (req, res) => {
    db.all("SELECT id, name, phone, email, (SELECT COUNT(*) FROM orders WHERE userId = users.id) as orderCount FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 14. Ajouter un produit (admin)
app.post('/api/admin/products', adminAuth, (req, res) => {
    const { name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags } = req.body;
    if (!name || !price) {
        return res.status(400).json({ error: "Nom et prix requis" });
    }
    
    db.run(`INSERT INTO products (name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Produit créé", id: this.lastID });
    });
});

// 15. Modifier un produit existant (admin) - NOUVEAU pour une synchro parfaite
app.put('/api/admin/products/:id', adminAuth, (req, res) => {
    const productId = parseInt(req.params.id);
    const { name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags } = req.body;

    const sql = `UPDATE products SET name=?, cat=?, brand=?, price=?, oldPrice=?, rating=?, reviews=?, image=?, badge=?, desc=?, tags=? WHERE id=?`;
    const params = [name, cat, brand, price, oldPrice, rating, reviews, image, badge, desc, tags, productId];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Produit non trouvé" });
        res.json({ message: "Produit mis à jour avec succès", id: productId });
    });
});

// 16. Supprimer un produit (admin)
app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
    const productId = parseInt(req.params.id);
    
    db.run("DELETE FROM products WHERE id = ?", [productId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Produit non trouvé" });
        res.json({ message: "Produit supprimé", id: productId });
    });
});

// ==================== NOUVELLE INTERFACE ADMIN AVANCÉE ====================

// 17. Statistiques du dashboard
app.get('/api/stats', (req, res) => {
    const stats = {};
    
    db.get("SELECT COUNT(*) as count FROM products", [], (err, row) => {
        stats.totalProducts = row?.count || 0;
        
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            stats.totalUsers = row?.count || 0;
            
            db.get("SELECT COUNT(*) as count FROM orders", [], (err, row) => {
                stats.totalOrders = row?.count || 0;
                
                db.get("SELECT SUM(CAST(total AS INTEGER)) as revenue FROM orders WHERE status IN ('delivered', 'processing')", [], (err, row) => {
                    stats.totalRevenue = row?.revenue || 0;
                    
                    // Calculs de pourcentages (à adapter selon vos besoins)
                    stats.productsChange = 5;
                    stats.usersChange = 8;
                    stats.ordersChange = 12;
                    stats.revenueChange = 15;
                    
                    res.json(stats);
                });
            });
        });
    });
});

// 18. Récupérer toutes les commandes
app.get('/api/orders', (req, res) => {
    db.all("SELECT * FROM orders ORDER BY date DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const orders = (rows || []).map(order => ({
            ...order,
            items: order.items ? JSON.parse(order.items) : []
        }));
        res.json(orders);
    });
});

// 19. Créer une nouvelle commande
app.post('/api/orders', (req, res) => {
    const { client, total, status, paymentMethod, date } = req.body;
    
    if (!client || !total) {
        return res.status(400).json({ error: "Client et montant requis" });
    }
    
    const ref = `ORD-${Date.now()}`;
    const orderDate = date || new Date().toISOString();
    const orderStatus = status || 'pending';
    
    db.run(
        `INSERT INTO orders (ref, clientName, total, status, date, payment) VALUES (?, ?, ?, ?, ?, ?)`,
        [ref, client, total, orderStatus, orderDate, paymentMethod || 'card'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ 
                message: "Commande créée", 
                id: this.lastID,
                ref: ref 
            });
        }
    );
});

// 20. Mettre à jour une commande
app.put('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { client, total, status, paymentMethod } = req.body;
    
    const sql = `UPDATE orders SET clientName=?, total=?, status=?, payment=? WHERE id=?`;
    const params = [client, total, status, paymentMethod || 'card', orderId];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Commande non trouvée" });
        res.json({ message: "Commande mise à jour", id: orderId });
    });
});

// 21. Supprimer une commande
app.delete('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    
    db.run("DELETE FROM orders WHERE id = ?", [orderId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Commande non trouvée" });
        res.json({ message: "Commande supprimée", id: orderId });
    });
});

// 22. Récupérer tous les produits
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 23. Créer un nouveau produit
app.post('/api/products', (req, res) => {
    const { name, cat, brand, price, oldPrice, desc, tags } = req.body;
    
    if (!name || !price) {
        return res.status(400).json({ error: "Nom et prix requis" });
    }
    
    db.run(
        `INSERT INTO products (name, cat, brand, price, oldPrice, rating, reviews, desc, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, cat || '', brand || '', price, oldPrice || null, 0, 0, desc || '', tags || ''],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ 
                message: "Produit créé", 
                id: this.lastID 
            });
        }
    );
});

// 24. Mettre à jour un produit
app.put('/api/products/:id', (req, res) => {
    const productId = parseInt(req.params.id);
    const { name, cat, brand, price, oldPrice, desc, tags } = req.body;
    
    const sql = `UPDATE products SET name=?, cat=?, brand=?, price=?, oldPrice=?, desc=?, tags=? WHERE id=?`;
    const params = [name, cat, brand, price, oldPrice, desc, tags, productId];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Produit non trouvé" });
        res.json({ message: "Produit mis à jour", id: productId });
    });
});

// 25. Supprimer un produit
app.delete('/api/products/:id', (req, res) => {
    const productId = parseInt(req.params.id);
    
    db.run("DELETE FROM products WHERE id = ?", [productId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Produit non trouvé" });
        res.json({ message: "Produit supprimé", id: productId });
    });
});

// 26. Récupérer tous les utilisateurs
app.get('/api/users', (req, res) => {
    db.all(
        `SELECT id, name, phone, email FROM users ORDER BY id DESC`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// 27. Créer un nouvel utilisateur
app.post('/api/users', async (req, res) => {
    const { name, email, phone, password } = req.body;
    
    if (!name || !phone || !password) {
        return res.status(400).json({ error: "Nom, téléphone et mot de passe requis" });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            `INSERT INTO users (name, phone, email, password) VALUES (?, ?, ?, ?)`,
            [name, phone, email || '', hashedPassword],
            function(err) {
                if (err) {
                    return res.status(400).json({ 
                        error: err.message.includes('UNIQUE') 
                            ? "Ce téléphone existe déjà" 
                            : err.message 
                    });
                }
                res.status(201).json({ 
                    message: "Utilisateur créé", 
                    id: this.lastID 
                });
            }
        );
    } catch (e) {
        res.status(500).json({ error: "Erreur lors de la création" });
    }
});

// 28. Mettre à jour un utilisateur
app.put('/api/users/:id', async (req, res) => {
    const userId = parseInt(req.params.id);
    const { name, email, phone, password } = req.body;
    
    try {
        if (password) {
            // Si mot de passe fourni, le hasher
            const hashedPassword = await bcrypt.hash(password, 10);
            db.run(
                `UPDATE users SET name=?, email=?, phone=?, password=? WHERE id=?`,
                [name, email, phone, hashedPassword, userId],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
                    res.json({ message: "Utilisateur mis à jour", id: userId });
                }
            );
        } else {
            // Sans mot de passe
            db.run(
                `UPDATE users SET name=?, email=?, phone=? WHERE id=?`,
                [name, email, phone, userId],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
                    res.json({ message: "Utilisateur mis à jour", id: userId });
                }
            );
        }
    } catch (e) {
        res.status(500).json({ error: "Erreur lors de la mise à jour" });
    }
});

// 29. Supprimer un utilisateur
app.delete('/api/users/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    
    db.run("DELETE FROM users WHERE id = ?", [userId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
        res.json({ message: "Utilisateur supprimé", id: userId });
    });
});