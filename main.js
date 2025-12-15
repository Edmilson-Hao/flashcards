import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, deleteDoc, writeBatch, addDoc, onSnapshot, updateDoc, doc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyA_R9qLO_Cj-b2mLGPPQFZPearLS8_ZL78",
    authDomain: "flashcards-6cc04.firebaseapp.com",
    projectId: "flashcards-6cc04",
    storageBucket: "flashcards-6cc04.firebasestorage.app",
    messagingSenderId: "689024752336",
    appId: "1:689024752336:web:1235587e239187a0ab9cd5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- SISTEMA SWAY (Substituto de Alert/Confirm) ---
const Sway = {
    container: () => document.getElementById('sway-container'),
    
    showToast: (msg, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = 'sway-toast';
        toast.innerText = msg;
        if(type === 'error') toast.style.background = '#e53e3e';
        if(type === 'success') toast.style.background = '#38a169';
        
        document.getElementById('sway-toast-container').appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },

    alert: (title, msg) => {
        return new Promise(resolve => {
            const el = document.getElementById('sway-container');
            el.innerHTML = `
                <div class="sway-overlay">
                    <div class="sway-modal">
                        <div class="sway-title">${title}</div>
                        <div class="sway-body">${msg}</div>
                        <div class="sway-footer">
                            <button class="sway-btn sway-primary" id="sway-ok">OK</button>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('sway-ok').onclick = () => {
                el.innerHTML = '';
                resolve();
            };
        });
    },

    confirm: (title, msg) => {
        return new Promise(resolve => {
            const el = document.getElementById('sway-container');
            el.innerHTML = `
                <div class="sway-overlay">
                    <div class="sway-modal">
                        <div class="sway-title">${title}</div>
                        <div class="sway-body">${msg}</div>
                        <div class="sway-footer">
                            <button class="sway-btn sway-secondary" id="sway-cancel">Cancelar</button>
                            <button class="sway-btn sway-primary" id="sway-ok">Confirmar</button>
                        </div>
                    </div>
                </div>
            `;
            document.getElementById('sway-ok').onclick = () => { el.innerHTML = ''; resolve(true); };
            document.getElementById('sway-cancel').onclick = () => { el.innerHTML = ''; resolve(false); };
        });
    }
};

// --- VARIÁVEIS GLOBAIS ---
let currentUser = null;
let flashcardsRef = null;
let allFlashcards = [];
let reviewQueue = [];
let currentCard = null;
let sessionStats = { total: 0, correct: 0, wrong: 0 }; // Estatísticas da sessão atual

// --- NAVEGAÇÃO ---
function showPage(pageId) {
    // Adicione 'aboutPage' nesta lista
    const pages = ['loading', 'loginPage', 'homePage', 'addPage', 'reviewPage', 'summaryPage', 'libraryPage', 'aboutPage'];
    
    pages.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const target = document.getElementById(pageId);
    if (target) target.classList.remove('hidden');
}

// --- AUTENTICAÇÃO ---
window.loginWithGoogle = () => {
    signInWithPopup(auth, new GoogleAuthProvider())
        .catch(err => Sway.showToast("Erro: " + err.message, 'error'));
};

window.logout = () => {
    signOut(auth).then(() => window.location.reload());
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('userPhoto').src = user.photoURL || '';
        document.getElementById('userName').innerText = user.displayName || 'Usuário';
        document.getElementById('userEmail').innerText = user.email;
        flashcardsRef = collection(db, "users", user.uid, "flashcards");
        setupDataListener();
    } else {
        showPage('loginPage');
    }
});

function setupDataListener() {
    onSnapshot(flashcardsRef, (snapshot) => {
        allFlashcards = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id;
            allFlashcards.push(data);
        });
        // Se estiver na tela de loading, vai para home
        if (!document.getElementById('loading').classList.contains('hidden')) {
            showPage('homePage');
        }
    });
}

// --- SALVAR CARD ---
window.saveFlashcard = async () => {
    const btn = document.querySelector('.btn-save');
    btn.disabled = true; btn.innerText = "Salvando...";

    try {
        await addDoc(flashcardsRef, {
            idiomaOriginal: document.getElementById('langOriginal').value,
            palavraOriginal: document.getElementById('wordOriginal').value,
            idiomaTraducao: document.getElementById('langTranslation').value,
            traducao: document.getElementById('wordTranslation').value,
            exemplos: [
                document.getElementById('ex1').value,
                document.getElementById('ex2').value,
                document.getElementById('ex3').value
            ].filter(e => e.trim() !== ""),
            createdAt: Timestamp.now(),
            nextReview: Timestamp.now(),
            reviewLevel: 0
        });
        Sway.showToast("Card salvo!", 'success');
        document.getElementById('formAddCard').reset();
        showPage('homePage');
    } catch (e) {
        Sway.showToast("Erro ao salvar", 'error');
    } finally {
        btn.disabled = false; btn.innerText = "Salvar Flashcard";
    }
};

// --- LÓGICA DE REVISÃO ---
window.startReview = async (forceAll = false) => {
    if (!allFlashcards.length) {
        await Sway.alert("Ops!", "Nenhum card cadastrado. Adicione alguns primeiro.");
        return;
    }

    // Reseta estatísticas
    sessionStats = { total: 0, correct: 0, wrong: 0 };

    // Filtra Cards
    if (forceAll) {
        reviewQueue = [...allFlashcards];
    } else {
        const now = new Date();
        reviewQueue = allFlashcards.filter(c => {
            if (!c.nextReview) return true;
            return c.nextReview.toDate() <= now;
        });
    }

    // PROBLEMA 2 RESOLVIDO: Se não tiver cards vencidos, pergunta se quer forçar
    if (reviewQueue.length === 0 && !forceAll) {
        const confirm = await Sway.confirm("Tudo em dia!", "Não há revisões pendentes para hoje. Deseja revisar todo o baralho mesmo assim?");
        if (confirm) {
            startReview(true); // Chama recursivamente forçando tudo
        }
        return;
    }

    reviewQueue.sort(() => Math.random() - 0.5);
    showPage('reviewPage');
    loadNextCard();
};

window.loadNextCard = () => {
    // Limpa UI
    document.getElementById('quizOptions').innerHTML = '';
    
    // Verifica se acabou
    if (reviewQueue.length === 0) {
        showSummary(); // PROBLEMA 3: Chama resumo em vez de "EmptyState"
        return;
    }

    currentCard = reviewQueue[0];
    document.getElementById('reviewCounter').innerText = `${reviewQueue.length} restantes`;
    
    // Preenche Card
    document.getElementById('cardLangOriginal').innerText = currentCard.idiomaOriginal || "Original";
    document.getElementById('cardWordOriginal').innerText = currentCard.palavraOriginal;

    generateQuizButtons(currentCard);
};

function generateQuizButtons(card) {
    const container = document.getElementById('quizOptions');
    const correct = card.traducao;
    let options = [correct];

    // Gera distratores
    let pool = allFlashcards.filter(c => c.traducao !== correct);
    while (options.length < 4) {
        if (pool.length > 0) {
            const rnd = Math.floor(Math.random() * pool.length);
            const val = pool[rnd].traducao;
            if (!options.includes(val)) options.push(val);
            pool.splice(rnd, 1);
        } else {
            options.push(`Opção ${options.length + 1}`);
        }
    }
    options.sort(() => Math.random() - 0.5);

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'btn-option';
        btn.innerText = opt;
        btn.onclick = () => checkAnswer(btn, opt, correct);
        container.appendChild(btn);
    });
}

window.checkAnswer = (btn, selected, correct) => {
    const btns = document.querySelectorAll('.btn-option');
    btns.forEach(b => b.disabled = true);

    const isCorrect = selected === correct;
    
    if (isCorrect) {
        btn.classList.add('btn-correct');
        sessionStats.correct++;
    } else {
        btn.classList.add('btn-wrong');
        sessionStats.wrong++;
        btns.forEach(b => { if (b.innerText === correct) b.classList.add('btn-correct'); });
    }
    sessionStats.total++;

    setTimeout(() => processResult(isCorrect), 1200);
};

window.processResult = async (isCorrect) => {
    reviewQueue.shift();
    if (!isCorrect) reviewQueue.push(currentCard);

    // Atualiza Firebase
    if (currentCard.id) {
        const nextDate = new Date();
        let newLevel = isCorrect ? (currentCard.reviewLevel || 0) + 1 : 0;
        const days = newLevel === 0 ? 0 : (newLevel === 1 ? 1 : newLevel * 2);
        nextDate.setDate(nextDate.getDate() + days);

        try {
            await updateDoc(doc(flashcardsRef, currentCard.id), {
                reviewLevel: newLevel,
                nextReview: Timestamp.fromDate(nextDate)
            });
        } catch(e) { console.error(e); }
    }
    loadNextCard();
};

function showSummary() {
    document.getElementById('sumTotal').innerText = sessionStats.total;
    document.getElementById('sumCorrect').innerText = sessionStats.correct;
    document.getElementById('sumWrong').innerText = sessionStats.wrong;
    showPage('summaryPage');
}

// --- EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    // Botões Home
    const btnReview = document.getElementById('btnReview');
    if(btnReview) btnReview.addEventListener('click', () => startReview(false));

    const btnAdd = document.getElementById('btnAdd');
    if(btnAdd) btnAdd.addEventListener('click', () => showPage('addPage'));

    const btnLogout = document.getElementById('btnLogout');
    if(btnLogout) btnLogout.addEventListener('click', async () => {
        if (await Sway.confirm("Sair", "Deseja desconectar sua conta?")) logout();
    });

    const btnLogin = document.getElementById('btnLogin');
    if(btnLogin) btnLogin.addEventListener('click', loginWithGoogle);

    // Botões Add
    const formAdd = document.getElementById('formAddCard');
    if(formAdd) formAdd.addEventListener('submit', (e) => { e.preventDefault(); saveFlashcard(); });
    
    const btnBackAdd = document.getElementById('btnBackAdd');
    if(btnBackAdd) btnBackAdd.addEventListener('click', () => showPage('homePage'));

    // Botões Review
    const btnBackReview = document.getElementById('btnBackReview');
    if(btnBackReview) btnBackReview.addEventListener('click', () => showPage('homePage'));

    // Botões Resumo
    const btnFinish = document.getElementById('btnFinishSession');
    if(btnFinish) btnFinish.addEventListener('click', () => showPage('homePage'));

    const btnRestart = document.getElementById('btnRestartSession');
    if(btnRestart) btnRestart.addEventListener('click', () => startReview(true));

    const btnLibrary = document.getElementById('btnLibrary');
    if (btnLibrary) {
        btnLibrary.addEventListener('click', () => {
            renderLibrary(); // Renderiza a lista atual
            showPage('libraryPage');
        });
    }

    // --- 5. TELA DE BIBLIOTECA ---
    
    // Botão Voltar
    const btnBackLib = document.getElementById('btnBackLib');
    if (btnBackLib) btnBackLib.onclick = () => showPage('homePage');

    // Pesquisa e Filtro
    const inputSearch = document.getElementById('libSearch');
    const selectFilter = document.getElementById('libFilter');
    
    if(inputSearch) inputSearch.addEventListener('keyup', filterLibrary);
    if(selectFilter) selectFilter.addEventListener('change', filterLibrary);

    // Botão Limpar Tudo
    const btnClearLib = document.getElementById('btnClearLibrary');
    if (btnClearLib) btnClearLib.onclick = clearAllLibrary;

    const btnAbout = document.getElementById('btnAbout');
    if (btnAbout) {
        btnAbout.addEventListener('click', () => showPage('aboutPage'));
    }

    // Botão Voltar (dentro da tela Sobre)
    const btnBackAbout = document.getElementById('btnBackAbout');
    if (btnBackAbout) {
        btnBackAbout.addEventListener('click', () => showPage('homePage'));
    }

    const btnOpenStats = document.getElementById('btnOpenStats');
    if(btnOpenStats) {
        btnOpenStats.addEventListener('click', () => {
            updateStatsUI(); // Calcula antes de mostrar
            const statsPage = document.getElementById('statsPage');
            statsPage.classList.remove('hidden');
        });
    }

    // Botão Fechar (X)
    const btnCloseStats = document.getElementById('btnCloseStats');
    if(btnCloseStats) {
        btnCloseStats.addEventListener('click', () => {
            document.getElementById('statsPage').classList.add('hidden');
        });
    }

    // Botão Limpar Tudo (Movido para dentro das estatísticas para segurança)
    const btnCleanData = document.getElementById('btnCleanData');
    if(btnCleanData) {
        btnCleanData.addEventListener('click', clearAllLibrary);
    }
});

// --- LÓGICA DA BIBLIOTECA ---

// Renderiza a lista e o gráfico
// --- CORREÇÃO NO MAIN.JS ---

window.renderLibrary = (cards = allFlashcards) => {
    const list = document.getElementById('libList');
    
    // Verificação de segurança: se a lista não existir no HTML, para a função
    if (!list) {
        console.error("Elemento 'libList' não encontrado no HTML");
        return;
    }

    list.innerHTML = '';

    // 1. Verifica se está vazio
    if (cards.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding: 40px; color:#94a3b8;">
                <span class="material-icons" style="font-size: 3rem; margin-bottom: 10px; display: block;">inbox</span>
                <p>Nenhuma palavra encontrada.</p>
            </div>`;
        return;
    }

    // 2. Renderiza a Lista de Cards
    cards.forEach(card => {
        const lvl = card.reviewLevel || 0;
        let lvlClass = 'lvl-0';
        let lvlLabel = 'Novo';

        if (lvl > 0 && lvl < 5) { 
            lvlClass = 'lvl-mid'; 
            lvlLabel = 'Estudando';
        }
        if (lvl >= 5) { 
            lvlClass = 'lvl-high'; 
            lvlLabel = 'Mestrado';
        }

        const item = document.createElement('div');
        item.className = 'lib-item';
        
        // Layout do item atualizado para o novo design
        item.innerHTML = `
            <div class="lib-info">
                <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 4px;">
                    <h4 style="margin:0; font-size: 1.1rem; color: #2D3748;">${card.palavraOriginal}</h4>
                    <span class="lib-level ${lvlClass}" style="font-size: 0.65rem; padding: 2px 6px; border-radius: 4px;">${lvlLabel}</span>
                </div>
                <p style="margin:0; color: #718096;">${card.traducao}</p>
            </div>
            <button class="btn-trash" onclick="deleteCard('${card.id}')" style="background: #FFF5F5; border-radius: 8px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                <span class="material-icons" style="color: #E53E3E; font-size: 1.2rem;">delete</span>
            </button>
        `;
        list.appendChild(item);
    });
};

// Filtro e Pesquisa
window.filterLibrary = () => {
    const term = document.getElementById('libSearch').value.toLowerCase();
    const filterType = document.getElementById('libFilter').value;

    const filtered = allFlashcards.filter(card => {
        // Filtro de Texto
        const matchesText = card.palavraOriginal.toLowerCase().includes(term) || 
                            card.traducao.toLowerCase().includes(term);
        
        // Filtro de Select
        let matchesType = true;
        const lvl = card.reviewLevel || 0;
        if (filterType === 'new') matchesType = (lvl === 0);
        if (filterType === 'learning') matchesType = (lvl > 0 && lvl < 5);
        if (filterType === 'mastered') matchesType = (lvl >= 5);

        return matchesText && matchesType;
    });

    renderLibrary(filtered);
};

// Excluir Um Card
window.deleteCard = async (id) => {
    if (await Sway.confirm("Excluir", "Tem certeza que deseja apagar esta palavra?")) {
        try {
            await deleteDoc(doc(flashcardsRef, id));
            Sway.showToast("Palavra removida.", "success");
            // O listener onSnapshot vai atualizar a tela automaticamente
        } catch (e) {
            Sway.showToast("Erro ao excluir.", "error");
        }
    }
};

// Limpar Tudo (Batch Delete)
window.clearAllLibrary = async () => {
    if (allFlashcards.length === 0) return;

    const confirm1 = await Sway.confirm("PERIGO", "Isso apagará TODAS as suas palavras. Tem certeza?");
    if (!confirm1) return;

    const confirm2 = await Sway.confirm("Última chance", "Essa ação é irreversível. Confirmar limpeza?");
    if (!confirm2) return;

    try {
        const batch = writeBatch(db);
        allFlashcards.forEach(card => {
            const ref = doc(flashcardsRef, card.id);
            batch.delete(ref);
        });
        await batch.commit();
        Sway.showToast("Biblioteca limpa!", "success");
    } catch (e) {
        console.error(e);
        Sway.showToast("Erro ao limpar.", "error");
    }
};

// Função para calcular e mostrar estatísticas
function updateStatsUI() {
    const total = allFlashcards.length;
    
    if (total === 0) {
        document.getElementById('statTotal').innerText = "0";
        document.getElementById('statAccuracy').innerText = "0%";
        // Zera o resto...
        return;
    }

    let countNew = 0;
    let countLearning = 0;
    let countMaster = 0;

    allFlashcards.forEach(c => {
        const lvl = c.reviewLevel || 0;
        if (lvl === 0) countNew++;
        else if (lvl < 5) countLearning++;
        else countMaster++;
    });

    // Cálculos
    const pctNew = Math.round((countNew / total) * 100);
    const pctLearn = Math.round((countLearning / total) * 100);
    const pctMaster = Math.round((countMaster / total) * 100);
    
    // Taxa de Retenção (Simulada baseada em quantos não são nível 0)
    const retention = Math.round(((total - countNew) / total) * 100);

    // Atualiza DOM
    document.getElementById('statTotal').innerText = total;
    document.getElementById('statAccuracy').innerText = retention + "%";
    
    document.getElementById('statNew').innerText = countNew;
    document.getElementById('statMaster').innerText = countMaster;

    // Atualiza Barras
    document.getElementById('barNew').style.width = pctNew + "%";
    document.getElementById('lblNew').innerText = pctNew + "%";

    document.getElementById('barLearning').style.width = pctLearn + "%";
    document.getElementById('lblLearning').innerText = pctLearn + "%";

    document.getElementById('barMaster').style.width = pctMaster + "%";
    document.getElementById('lblMaster').innerText = pctMaster + "%";
}