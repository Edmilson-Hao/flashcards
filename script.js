// script.js - VERSÃO CORRIGIDA E FUNCIONAL (2025)

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    onAuthStateChanged, 
    signInWithCustomToken, 
    signInAnonymously, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    updateDoc, 
    onSnapshot, 
    collection, 
    Timestamp, 
    addDoc, 
    deleteDoc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuração Firebase (funciona local ou no Canvas)
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

let currentUser = null;
let flashcardsCollectionRef = null;
let allFlashcards = [];

// Intervalos Ebbinghaus (em dias)
const EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 90, 180, 365];

function getNextReviewDate(level) {
    const days = EBBINGHAUS_INTERVALS[Math.min(level, EBBINGHAUS_INTERVALS.length - 1)];
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

// =================== AUTENTICAÇÃO ===================
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        document.getElementById('user-display').textContent = user.displayName || "Anônimo";
        document.getElementById('user-id-display').textContent = user.uid.substring(0, 8) + "...";

        // CORREÇÃO PRINCIPAL: caminho correto da coleção
        flashcardsCollectionRef = collection(db, "users", user.uid, "flashcards");
        
        setupRealtimeListener();
        showView('view-home');
    } else {
        showView('view-login');
    }
    hideLoading();
});

async function tryAnonymousLogin() {
    try {
        await signInAnonymously(auth);
    } catch (err) {
        console.error("Erro login anônimo:", err);
    }
}

// =================== NAVEGAÇÃO ===================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    document.body.classList.remove('correct-bg', 'incorrect-bg');

    if (viewId === 'view-revisao') loadNextCard();
    if (viewId === 'view-biblioteca') renderLibrary();
}

function hideLoading() {
    document.getElementById('view-loading').classList.add('hidden');
}

// =================== REALTIME LISTENER ===================
function setupRealtimeListener() {
    if (!flashcardsCollectionRef) return;

    onSnapshot(flashcardsCollectionRef, (snapshot) => {
        allFlashcards = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            if (data.nextReview) data.nextReview = data.nextReview.toDate();
            allFlashcards.push(data);
        });
        console.log("Cards carregados:", allFlashcards.length);

        if (!document.getElementById('view-biblioteca').classList.contains('hidden')) {
            renderLibrary();
        }
        if (!document.getElementById('view-revisao').classList.contains('hidden')) {
            loadNextCard();
        }
    });
}

// =================== ADICIONAR CARDS ===================
async function saveFlashcard(cardData) {
    try {
        const newCard = {
            ...cardData,
            reviewLevel: 0,
            nextReview: Timestamp.fromDate(getNextReviewDate(0)),
            createdAt: Timestamp.now(),
            totalReviews: 0,
            correctCount: 0
        };
        await addDoc(flashcardsCollectionRef, newCard);
        return true;
    } catch (err) {
        console.error("Erro ao salvar card:", err);
        return false;
    }
}

// =================== REVISÃO ===================
let currentCard = null;
let isFlipped = false;

function loadNextCard() {
    const now = new Date();
    const due = allFlashcards
        .filter(c => c.nextReview <= now)
        .sort((a, b) => a.nextReview - b.nextReview);

    if (due.length === 0) {
        document.getElementById('card-palavra-front').textContent = "Nenhum card para revisar hoje!";
        document.getElementById('card-idioma-front').textContent = "Parabéns!";
        document.getElementById('revisao-message').textContent = "Volte amanhã!";
        document.getElementById('quiz-options-container').classList.add('hidden');
        document.getElementById('quiz-typing-container').classList.add('hidden');
        return;
    }

    currentCard = due[0];
    isFlipped = false;
    document.getElementById('flashcard-container').classList.remove('is-flipped');
    document.body.classList.remove('correct-bg', 'incorrect-bg');

    document.getElementById('card-idioma-front').textContent = currentCard.idioma;
    document.getElementById('card-palavra-front').textContent = currentCard.palavra;
    document.getElementById('card-traducao-back').textContent = currentCard.traducao;

    const exemplosList = document.getElementById('card-exemplos-back');
    exemplosList.innerHTML = '';
    (currentCard.exemplos || []).forEach(ex => {
        const li = document.createElement('li');
        li.textContent = ex;
        exemplosList.appendChild(li);
    });

    document.getElementById('revisao-message').textContent = `${due.length} card(s) para revisar hoje.`;

    // Modo digitação após nível 3
    if (currentCard.reviewLevel >= 3) {
        document.getElementById('quiz-options-container').classList.add('hidden');
        document.getElementById('quiz-typing-container').classList.remove('hidden');
        document.getElementById('typing-input').focus();
    } else {
        document.getElementById('quiz-typing-container').classList.add('hidden');
        document.getElementById('quiz-options-container').classList.remove('hidden');
        setupMultipleChoice();
    }
}

function setupMultipleChoice() {
    const others = allFlashcards
        .filter(c => c.id !== currentCard.id)
        .map(c => c.traducao);
    
    const wrong = others.sort(() => 0.5 - Math.random()).slice(0, 3);
    const options = [currentCard.traducao, ...wrong].sort(() => 0.5 - Math.random());

    document.querySelectorAll('.quiz-option-btn').forEach((btn, i) => {
        btn.textContent = options[i];
        btn.onclick = () => checkAnswer(options[i]);
    });
}

function checkAnswer(answer) {
    if (isFlipped) return;
    const correct = answer.trim().toLowerCase() === currentCard.traducao.trim().toLowerCase();
    flipCard(correct);
    updateReviewLevel(correct);
}

function flipCard(correct) {
    isFlipped = true;
    document.getElementById('flashcard-container').classList.add('is-flipped');
    document.body.classList.add(correct ? 'correct-bg' : 'incorrect-bg');
    document.getElementById('review-result-controls').classList.remove('hidden');
    document.getElementById('quiz-options-container').classList.add('hidden');
    document.getElementById('quiz-typing-container').classList.add('hidden');
}

async function updateReviewLevel(correct) {
    const newLevel = correct 
        ? Math.min(currentCard.reviewLevel + 1, 9)
        : Math.max(0, currentCard.reviewLevel - 1);

    const nextDate = getNextReviewDate(newLevel);

    try {
        await updateDoc(doc(flashcardsCollectionRef, currentCard.id), {
            reviewLevel: newLevel,
            nextReview: Timestamp.fromDate(nextDate),
            lastReviewed: Timestamp.now(),
            totalReviews: (currentCard.totalReviews || 0) + 1,
            correctCount: (currentCard.correctCount || 0) + (correct ? 1 : 0)
        });
    } catch (err) {
        console.error("Erro ao atualizar revisão:", err);
    }
}

// =================== BIBLIOTECA ===================
function renderLibrary() {
    const tbody = document.getElementById('biblioteca-table-body');
    const msg = document.getElementById('biblioteca-message');
    tbody.innerHTML = '';

    if (allFlashcards.length === 0) {
        msg.textContent = "Nenhum flashcard cadastrado ainda.";
        msg.classList.remove('hidden');
        return;
    }
    msg.classList.add('hidden');

    const sorted = [...allFlashcards].sort((a, b) => a.palavra.localeCompare(b.palavra));

    sorted.forEach((card, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm">${i + 1}</td>
            <td class="px-6 py-4 text-sm">${card.idioma}</td>
            <td class="px-6 py-4 text-sm font-medium text-indigo-600">${card.palavra}</td>
            <td class="px-6 py-4 text-sm ${card.reviewLevel >= 5 ? 'text-green-600 font-bold' : card.reviewLevel >= 2 ? 'text-blue-600' : 'text-red-600'}">
                Nível ${card.reviewLevel}
            </td>
            <td class="px-6 py-4 text-sm">${card.nextReview?.toLocaleDateString() || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">
                <button data-id="${card.id}" class="btn-delete-card text-red-600 hover:text-red-800 text-sm">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-delete-card').forEach(btn => {
        btn.onclick = async () => {
            if (confirm("Excluir este flashcard permanentemente?")) {
                await deleteDoc(doc(flashcardsCollectionRef, btn.dataset.id));
            }
        };
    });
}

// =================== EVENT LISTENERS ===================
document.getElementById('btn-login-google').onclick = () => {
    signInWithPopup(auth, new GoogleAuthProvider());
};

document.getElementById('btn-logout').onclick = () => signOut(auth);

document.getElementById('btn-home-adicionar').onclick = () => showView('view-add-menu');
document.getElementById('btn-home-revisar').onclick = () => showView('view-revisao');
document.getElementById('btn-home-biblioteca').onclick = () => showView('view-biblioteca');

document.getElementById('btn-add-manual').onclick = () => showView('view-add-manual');
document.getElementById('btn-add-automatico').onclick = () => showView('view-add-automatico');

document.querySelectorAll('[id^="btn-back-from-"]').forEach(btn => {
    btn.onclick = () => showView('view-home');
});
document.getElementById('btn-back-from-add-menu').onclick = () => showView('view-home');

// Adicionar Manual (VERSÃO CORRIGIDA - LINHA ~302)
document.getElementById('form-add-manual').addEventListener('submit', async (e) => {
    e.preventDefault();

    // CORREÇÃO: Usa getElementById direto para evitar problemas com form.elements
    const idioma = document.getElementById('manual-idioma').value.trim();
    const palavra = document.getElementById('manual-palavra').value.trim();
    const traducao = document.getElementById('manual-traducao').value.trim();
    const exemplosStr = document.getElementById('manual-exemplos').value.trim();

    // Validação
    if (!idioma || !palavra || !traducao) {
        const msg = document.getElementById('manual-message');
        msg.textContent = 'Preencha idioma, palavra e tradução.';
        msg.className = 'mt-4 text-red-600 font-bold';
        return;
    }

    const exemplos = exemplosStr.split(';').map(s => s.trim()).filter(Boolean);
    if (exemplos.length === 0) {
        const msg = document.getElementById('manual-message');
        msg.textContent = 'Adicione pelo menos um exemplo (separados por ";").';
        msg.className = 'mt-4 text-red-600 font-bold';
        return;
    }

    const cardData = { idioma, palavra, traducao, exemplos };

    const msg = document.getElementById('manual-message');
    const success = await saveFlashcard(cardData);
    
    if (success) {
        msg.textContent = '✅ Flashcard salvo com sucesso!';
        msg.className = 'mt-4 text-green-600 font-bold';
        document.getElementById('form-add-manual').reset(); // Limpa o form
        setTimeout(() => { msg.textContent = ''; }, 3000); // Limpa mensagem após 3s
    } else {
        msg.textContent = '❌ Erro ao salvar. Tente novamente.';
        msg.className = 'mt-4 text-red-600 font-bold';
    }
});

// Flip ao clicar no card
document.getElementById('flashcard-container').onclick = () => {
    if (!isFlipped && currentCard && currentCard.reviewLevel >= 3) {
        document.getElementById('typing-input').focus();
    }
};

// Digitação
document.getElementById('typing-submit-btn').onclick = () => {
    const input = document.getElementById('typing-input').value.trim();
    const msg = document.getElementById('typing-message');
    if (!input) return;

    const correct = input.toLowerCase() === currentCard.traducao.toLowerCase();
    msg.textContent = correct ? "Correto!" : `Errado. Resposta: ${currentCard.traducao}`;
    msg.className = correct ? "text-green-600" : "text-red-600";
    flipCard(correct);
    updateReviewLevel(correct);
};

// Próximo card
document.getElementById('btn-next-card').onclick = loadNextCard;

// JSON em massa
document.getElementById('btn-processar-json').onclick = async () => {
    const txt = document.getElementById('automatico-json-input');
    const msg = document.getElementById('automatico-message');
    try {
        const arr = JSON.parse(txt.value);
        if (!Array.isArray(arr)) throw new Error("Deve ser um array");

        let ok = 0;
        for (const c of arr) {
            if (c.idioma && c.palavra && c.traducao && Array.isArray(c.exemplos)) {
                await saveFlashcard(c);
                ok++;
            }
        }
        msg.textContent = `${ok} cards salvos com sucesso!`;
        msg.className = "text-green-600";
        txt.value = "";
    } catch (err) {
        msg.textContent = "JSON inválido: " + err.message;
        msg.className = "text-red-600";
    }
};

// Inicialização
window.onload = () => {
    // Tenta login anônimo se não houver token
    if (!auth.currentUser) {
        tryAnonymousLogin();
    }
};