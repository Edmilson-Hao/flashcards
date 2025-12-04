// script.js - VERSÃO COMPLETA CORRIGIDA

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    updateDoc, 
    onSnapshot, 
    collection, 
    Timestamp, 
    addDoc, 
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Configuração Firebase
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
let currentReviewSession = [];
let currentSessionIndex = 0;
let sessionReviewCount = 0;
let isForcedSession = false;
let isProcessingJSON = false;
let isReviewLoop = false;

// Intervalos Ebbinghaus (em dias)
const EBBINGHAUS_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 90, 180, 365];

// =================== FUNÇÕES UTILITÁRIAS ===================
function getNextReviewDate(level) {
    const days = EBBINGHAUS_INTERVALS[Math.min(level, EBBINGHAUS_INTERVALS.length - 1)];
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
}

function hideLoading() {
    const loadingView = document.getElementById('view-loading');
    if (loadingView) {
        loadingView.classList.add('hidden');
    }
}

function showLoading(text = "Carregando...") {
    const loadingView = document.getElementById('view-loading');
    if (loadingView) {
        const loadingText = loadingView.querySelector('p');
        if (loadingText) loadingText.textContent = text;
        loadingView.classList.remove('hidden');
    }
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = document.getElementById(viewId);
    if (view) {
        view.classList.remove('hidden');
    }
    document.body.classList.remove('correct-bg', 'incorrect-bg');

    if (viewId === 'view-revisao') {
        isForcedSession = false;
        
        const novaRodadaBtn = document.getElementById('btn-nova-rodada');
        if (novaRodadaBtn) {
            novaRodadaBtn.innerHTML = `
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Nova Rodada
            `;
            novaRodadaBtn.classList.remove('bg-purple-600', 'hover:bg-purple-700');
            novaRodadaBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
            novaRodadaBtn.disabled = false;
        }
        
        setupReviewSession();
        loadNextCard();
    }
    
    if (viewId === 'view-biblioteca') renderLibrary();
    if (viewId === 'view-estatisticas') renderEstatisticas();
}

function showMessage(elementId, message, type = 'info', duration = 3000) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.textContent = message;
    
    element.classList.remove('text-red-600', 'text-green-600', 'text-blue-600', 'text-yellow-600', 'hidden');
    
    switch(type) {
        case 'success':
            element.classList.add('text-green-600', 'font-bold');
            break;
        case 'error':
            element.classList.add('text-red-600', 'font-bold');
            break;
        case 'warning':
            element.classList.add('text-yellow-600', 'font-bold');
            break;
        case 'info':
            element.classList.add('text-blue-600', 'font-bold');
            break;
        default:
            element.classList.add('text-gray-600');
    }
    
    if (duration > 0) {
        setTimeout(() => {
            element.textContent = '';
        }, duration);
    }
}

// =================== REVISÃO ===================
let currentCard = null;
let isFlipped = false;
let currentDirection = 'forward';

function setupReviewSession() {
    const now = new Date();
    
    if (isForcedSession) {
        currentReviewSession = allFlashcards
            .filter(card => card.reviewLevel < 9)
            .sort(() => 0.5 - Math.random());
    } else {
        currentReviewSession = allFlashcards
            .filter(c => {
                if (!c.nextReview) return false;
                const reviewDate = c.nextReview instanceof Date ? c.nextReview : c.nextReview.toDate();
                return reviewDate <= now;
            })
            .sort((a, b) => {
                const dateA = a.nextReview instanceof Date ? a.nextReview : a.nextReview.toDate();
                const dateB = b.nextReview instanceof Date ? b.nextReview : b.nextReview.toDate();
                return dateA - dateB;
            });
    }
    
    currentSessionIndex = 0;
    sessionReviewCount = 0;
    
    updateReviewCounter();
    
    if (currentReviewSession.length === 0) {
        const cardFront = document.getElementById('card-palavra-front');
        const revisaoMessage = document.getElementById('revisao-message');
        
        if (cardFront && revisaoMessage) {
            if (isForcedSession) {
                cardFront.textContent = "Todos os cards já estão no nível máximo!";
                revisaoMessage.textContent = "Parabéns! Você dominou todos os cards.";
            } else {
                cardFront.textContent = "Nenhum card para revisar hoje!";
                revisaoMessage.textContent = "Volte amanhã ou inicie uma nova rodada.";
            }
        }
        
        hideQuizControls();
        return false;
    }
    
    return true;
}

function hideQuizControls() {
    const quizOptions = document.getElementById('quiz-options-container');
    const quizTyping = document.getElementById('quiz-typing-container');
    const resultControls = document.getElementById('review-result-controls');
    
    if (quizOptions) quizOptions.classList.add('hidden');
    if (quizTyping) quizTyping.classList.add('hidden');
    if (resultControls) resultControls.classList.add('hidden');
}

function updateReviewCounter() {
    const cardsRemainingElement = document.getElementById('cards-remaining');
    const revisaoMessage = document.getElementById('revisao-message');
    
    if (!cardsRemainingElement || !revisaoMessage) return;
    
    const cardsRemaining = Math.max(0, currentReviewSession.length - currentSessionIndex);
    cardsRemainingElement.textContent = cardsRemaining;
    
    const totalDue = allFlashcards.filter(c => {
        if (!c.nextReview) return false;
        const reviewDate = c.nextReview instanceof Date ? c.nextReview : c.nextReview.toDate();
        return reviewDate <= new Date();
    }).length;
    
    const message = isForcedSession ? 
        `Sessão forçada: ${currentReviewSession.length} card(s) para revisar` :
        `${totalDue} card(s) vencidos hoje | Sessão: ${sessionReviewCount} revisados`;
    
    revisaoMessage.textContent = message;
}

function loadNextCard() {
    if (isReviewLoop) return;
    isReviewLoop = true;
    
    setTimeout(() => {
        isReviewLoop = false;
    }, 100);
    
    if (currentSessionIndex >= currentReviewSession.length) {
        if (isForcedSession) {
            const cardFront = document.getElementById('card-palavra-front');
            const revisaoMessage = document.getElementById('revisao-message');
            
            if (cardFront && revisaoMessage) {
                cardFront.textContent = "Sessão forçada concluída!";
                revisaoMessage.textContent = `Você revisou ${sessionReviewCount} cards.`;
            }
            
            hideQuizControls();
            return;
        }
        
        if (!setupReviewSession()) {
            return;
        }
    }

    if (!currentReviewSession[currentSessionIndex]) {
        console.error("Card não encontrado no índice:", currentSessionIndex);
        return;
    }

    currentCard = currentReviewSession[currentSessionIndex];
    currentSessionIndex++;
    sessionReviewCount++;
    
    isFlipped = false;
    const flashcardContainer = document.getElementById('flashcard-container');
    if (flashcardContainer) {
        flashcardContainer.classList.remove('is-flipped');
        flashcardContainer.style.pointerEvents = 'auto';
    }
    
    document.body.classList.remove('correct-bg', 'incorrect-bg');

    currentDirection = currentCard.askReverse ? 'reverse' : 'forward';
    
    if (flashcardsCollectionRef && currentCard.id) {
        updateDoc(doc(flashcardsCollectionRef, currentCard.id), {
            askReverse: !currentCard.askReverse
        }).catch(err => console.error("Erro ao atualizar askReverse:", err));
    }

    const cardIdiomaFront = document.getElementById('card-idioma-front');
    const cardPalavraFront = document.getElementById('card-palavra-front');
    const cardTraducaoBack = document.getElementById('card-traducao-back');
    
    if (cardIdiomaFront && cardPalavraFront && cardTraducaoBack) {
        if (currentDirection === 'forward') {
            cardIdiomaFront.textContent = currentCard.idiomaOriginal || "Idioma";
            cardPalavraFront.textContent = currentCard.palavraOriginal || "Palavra";
            cardTraducaoBack.textContent = currentCard.traducao || "Tradução";
        } else {
            cardIdiomaFront.textContent = currentCard.idiomaTraducao || "Idioma";
            cardPalavraFront.textContent = currentCard.traducao || "Tradução";
            cardTraducaoBack.textContent = currentCard.palavraOriginal || "Palavra";
        }
    }

    const exemplosList = document.getElementById('card-exemplos-back');
    if (exemplosList) {
        exemplosList.innerHTML = '';
        (currentCard.exemplos || []).forEach(ex => {
            const li = document.createElement('li');
            li.textContent = ex;
            exemplosList.appendChild(li);
        });
    }

    updateReviewCounter();

    const shouldUseTyping = currentCard.consecutiveCorrect >= 2 && currentCard.lastAnswerCorrect;
    const quizOptions = document.getElementById('quiz-options-container');
    const quizTyping = document.getElementById('quiz-typing-container');
    const typingInput = document.getElementById('typing-input');
    const typingMessage = document.getElementById('typing-message');
    const resultControls = document.getElementById('review-result-controls');
    
    if (shouldUseTyping && quizOptions && quizTyping && typingInput && typingMessage) {
        quizOptions.classList.add('hidden');
        quizTyping.classList.remove('hidden');
        typingInput.value = '';
        typingMessage.textContent = '';
        setTimeout(() => typingInput.focus(), 100);
        if (resultControls) resultControls.classList.add('hidden');
    } else if (quizOptions && quizTyping) {
        quizTyping.classList.add('hidden');
        quizOptions.classList.remove('hidden');
        if (resultControls) resultControls.classList.add('hidden');
        setupMultipleChoice();
    }
}

function setupMultipleChoice() {
    if (!currentCard) return;
    
    let opcoesCorretas;
    let opcoesErradas;
    
    if (currentDirection === 'forward') {
        opcoesCorretas = [currentCard.traducao || ''];
        opcoesErradas = currentCard.outrasOpcoes || [];
    } else {
        opcoesCorretas = [currentCard.palavraOriginal || ''];
        
        const outrasPalavras = allFlashcards
            .filter(c => c.id !== currentCard.id && 
                        c.idiomaOriginal === currentCard.idiomaOriginal &&
                        c.palavraOriginal !== currentCard.palavraOriginal)
            .map(c => c.palavraOriginal)
            .filter((value, index, self) => self.indexOf(value) === index);
        
        opcoesErradas = [...outrasPalavras]
            .sort(() => 0.5 - Math.random())
            .slice(0, 3);
    }
    
    opcoesErradas = opcoesErradas.filter(opcao => opcao !== opcoesCorretas[0]);
    
    while (opcoesErradas.length < 3) {
        const novaOpcao = `Alternativa ${opcoesErradas.length + 1}`;
        if (!opcoesErradas.includes(novaOpcao) && novaOpcao !== opcoesCorretas[0]) {
            opcoesErradas.push(novaOpcao);
        }
    }
    
    const options = [...opcoesCorretas, ...opcoesErradas.slice(0, 3)]
        .sort(() => 0.5 - Math.random());

    document.querySelectorAll('.quiz-option-btn').forEach((btn, i) => {
        if (options[i]) {
            btn.textContent = options[i];
            btn.disabled = false;
            btn.classList.remove('selected-correct', 'selected-incorrect');
            btn.onclick = () => checkAnswer(options[i]);
        } else {
            btn.textContent = '';
            btn.disabled = true;
        }
    });
}

function checkAnswer(answer) {
    if (isFlipped || !currentCard) return;
    
    let correct;
    if (currentDirection === 'forward') {
        correct = answer.trim().toLowerCase() === (currentCard.traducao || '').trim().toLowerCase();
    } else {
        correct = answer.trim().toLowerCase() === (currentCard.palavraOriginal || '').trim().toLowerCase();
    }
    
    document.querySelectorAll('.quiz-option-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.textContent.trim().toLowerCase() === answer.trim().toLowerCase()) {
            btn.classList.add(correct ? 'selected-correct' : 'selected-incorrect');
        }
    });
    
    flipCard(correct);
    updateReviewLevel(correct);
}

function flipCard(correct) {
    isFlipped = true;
    const flashcardContainer = document.getElementById('flashcard-container');
    if (flashcardContainer) {
        flashcardContainer.classList.add('is-flipped');
        flashcardContainer.style.pointerEvents = 'none';
    }
    
    document.body.classList.add(correct ? 'correct-bg' : 'incorrect-bg');
    
    const resultControls = document.getElementById('review-result-controls');
    const quizOptions = document.getElementById('quiz-options-container');
    const quizTyping = document.getElementById('quiz-typing-container');
    
    if (resultControls) resultControls.classList.remove('hidden');
    if (quizOptions) quizOptions.classList.add('hidden');
    if (quizTyping) quizTyping.classList.add('hidden');
}

async function updateReviewLevel(correct) {
    if (!currentCard || !flashcardsCollectionRef || !currentCard.id) return;
    
    const newConsecutiveCorrect = correct ? 
        (currentCard.consecutiveCorrect || 0) + 1 : 
        0;
    
    const newLevel = correct ? 
        Math.min((currentCard.reviewLevel || 0) + 1, 9) : 
        Math.max(0, (currentCard.reviewLevel || 0) - 1);
    
    const nextDate = getNextReviewDate(newLevel);

    try {
        await updateDoc(doc(flashcardsCollectionRef, currentCard.id), {
            reviewLevel: newLevel,
            consecutiveCorrect: newConsecutiveCorrect,
            lastAnswerCorrect: correct,
            nextReview: Timestamp.fromDate(nextDate),
            lastReviewed: Timestamp.now(),
            totalReviews: (currentCard.totalReviews || 0) + 1,
            correctCount: (currentCard.correctCount || 0) + (correct ? 1 : 0)
        });
        
        setTimeout(() => {
            updateReviewCounter();
        }, 100);
    } catch (err) {
        console.error("Erro ao atualizar revisão:", err);
        showMessage('revisao-message', 'Erro ao salvar revisão', 'error');
    }
}

function startForcedReviewSession() {
    if (!confirm("Iniciar nova rodada de revisão?\n\nIsso revisará todos os cards disponíveis, independentemente da data de revisão.")) {
        return;
    }
    
    isForcedSession = true;
    setupReviewSession();
    
    const novaRodadaBtn = document.getElementById('btn-nova-rodada');
    if (novaRodadaBtn) {
        novaRodadaBtn.innerHTML = `
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Sessão Forçada
        `;
        novaRodadaBtn.classList.add('bg-purple-600', 'hover:bg-purple-700');
        novaRodadaBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
        
        novaRodadaBtn.disabled = true;
        setTimeout(() => {
            if (novaRodadaBtn) novaRodadaBtn.disabled = false;
        }, 2000);
    }
    
    loadNextCard();
}

// =================== BIBLIOTECA ===================
function renderLibrary() {
    const tbody = document.getElementById('biblioteca-table-body');
    const msg = document.getElementById('biblioteca-message');
    const totalCardsCount = document.getElementById('total-cards-count');
    
    if (!tbody || !msg || !totalCardsCount) return;
    
    tbody.innerHTML = '';

    if (allFlashcards.length === 0) {
        msg.textContent = "Nenhum flashcard cadastrado ainda.";
        msg.classList.remove('hidden');
        totalCardsCount.textContent = "0";
        return;
    }

    msg.classList.add('hidden');
    totalCardsCount.textContent = allFlashcards.length;
    
    const sorted = [...allFlashcards].sort((a, b) => (a.palavraOriginal || '').localeCompare(b.palavraOriginal || ''));

    sorted.forEach((card, i) => {
        const tr = document.createElement('tr');
        
        const accuracy = card.totalReviews > 0 ? 
            Math.round((card.correctCount / card.totalReviews) * 100) : 0;
        
        const nextReviewDate = card.nextReview ? 
            (card.nextReview instanceof Date ? card.nextReview : card.nextReview.toDate()).toLocaleDateString('pt-BR') : 
            'N/A';
        
        let accuracyColor = 'text-gray-500';
        if (accuracy >= 80) accuracyColor = 'text-green-600 font-bold';
        else if (accuracy >= 60) accuracyColor = 'text-blue-600';
        else if (accuracy > 0) accuracyColor = 'text-yellow-600';
        
        let levelColor = 'text-red-600';
        if (card.reviewLevel >= 5) levelColor = 'text-green-600 font-bold';
        else if (card.reviewLevel >= 2) levelColor = 'text-blue-600';
        
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm">${i + 1}</td>
            <td class="px-6 py-4 text-sm">
                <span class="font-semibold">${card.idiomaOriginal || 'N/A'}</span> → 
                <span class="font-semibold">${card.idiomaTraducao || 'N/A'}</span>
            </td>
            <td class="px-6 py-4 text-sm">
                <div class="font-medium text-indigo-600">${card.palavraOriginal || 'N/A'}</div>
                <div class="text-gray-500 text-xs">${card.traducao || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-sm">
                <div class="${levelColor}">
                    Nível ${card.reviewLevel || 0}
                </div>
                <div class="text-xs text-gray-500">Acertos: ${card.consecutiveCorrect || 0} seg.</div>
            </td>
            <td class="px-6 py-4 text-sm">${nextReviewDate}</td>
            <td class="px-6 py-4 text-sm ${accuracyColor}">
                ${accuracy}%
            </td>
            <td class="px-6 py-4 text-sm">
                <button data-id="${card.id}" class="btn-delete-card text-red-600 hover:text-red-800 text-sm mr-3">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-delete-card').forEach(btn => {
        btn.onclick = async () => {
            if (confirm("Excluir este flashcard permanentemente?")) {
                try {
                    await deleteDoc(doc(flashcardsCollectionRef, btn.dataset.id));
                    showMessage('biblioteca-message', 'Card excluído com sucesso!', 'success', 2000);
                } catch (err) {
                    showMessage('biblioteca-message', 'Erro ao excluir card', 'error', 2000);
                }
            }
        };
    });
}

// =================== LIMPAR BIBLIOTECA ===================
async function limparBiblioteca() {
    if (allFlashcards.length === 0) {
        showMessage('biblioteca-message', 'A biblioteca já está vazia.', 'info', 3000);
        return;
    }
    
    if (!confirm("🚨 ATENÇÃO: Esta ação irá excluir TODOS os flashcards permanentemente.\n\nEsta ação NÃO pode ser desfeita.\n\nDeseja continuar?")) {
        return;
    }
    
    if (!confirm("⚠️ Você tem CERTEZA ABSOLUTA?\n\nTodos os seus dados de aprendizado serão perdidos.\n\nDigite 'LIMPAR' para confirmar:")) {
        return;
    }
    
    const userInput = prompt("Digite 'LIMPAR' (em maiúsculas) para confirmar a exclusão de todos os flashcards:");
    
    if (userInput !== 'LIMPAR') {
        showMessage('biblioteca-message', 'Operação cancelada. Nada foi excluído.', 'warning', 3000);
        return;
    }
    
    showMessage('biblioteca-message', 'Excluindo todos os flashcards...', 'info', 0);
    
    try {
        // Usa batch para exclusão em lote
        const batch = writeBatch(db);
        allFlashcards.forEach(card => {
            if (card.id) {
                const cardRef = doc(flashcardsCollectionRef, card.id);
                batch.delete(cardRef);
            }
        });
        
        await batch.commit();
        
        // Limpa o array local imediatamente
        allFlashcards = [];
        currentReviewSession = [];
        currentSessionIndex = 0;
        sessionReviewCount = 0;
        currentCard = null;
        
        showMessage('biblioteca-message', '✅ Biblioteca limpa com sucesso! Todos os flashcards foram excluídos.', 'success', 5000);
        
        // Atualiza a interface imediatamente
        renderLibrary();
        
        // Se estiver na tela de estatísticas, atualiza também
        if (!document.getElementById('view-estatisticas').classList.contains('hidden')) {
            renderEstatisticas();
        }
        
        // Se estiver na tela de revisão, recarrega
        if (!document.getElementById('view-revisao').classList.contains('hidden')) {
            setupReviewSession();
            loadNextCard();
        }
        
    } catch (err) {
        console.error("Erro ao limpar biblioteca:", err);
        showMessage('biblioteca-message', '❌ Erro ao limpar biblioteca. Tente novamente.', 'error', 5000);
    }
}

// =================== ESTATÍSTICAS ===================
function renderEstatisticas() {
    // Limpa estatísticas anteriores
    clearEstatisticas();
    
    if (allFlashcards.length === 0) {
        showNoDataMessage();
        return;
    }
    
    // Atualiza estatísticas gerais
    updateEstatisticasGerais();
    
    // Renderiza as seções
    renderDistribuicaoNiveis();
    renderDistribuicaoIdioma();
    renderTopRevisados();
    renderEstatisticasDetalhadas();
}

function clearEstatisticas() {
    // Limpa todos os containers de estatísticas
    const containers = [
        'nivel-distribution',
        'idioma-distribution',
        'top-revisados-table',
        'detailed-stats-table'
    ];
    
    containers.forEach(containerId => {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = '';
        }
    });
}

function showNoDataMessage() {
    // Atualiza cards com zeros
    document.getElementById('stats-total-cards').textContent = '0';
    document.getElementById('stats-revisoes-hoje').textContent = '0';
    document.getElementById('stats-taxa-acerto').textContent = '0%';
    document.getElementById('stats-nivel-medio').textContent = '0';
    
    // Mensagem de nenhum dado
    const nivelContainer = document.getElementById('nivel-distribution');
    if (nivelContainer) {
        nivelContainer.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <svg class="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <p class="text-lg font-medium">Nenhum flashcard cadastrado</p>
                <p class="text-sm">Adicione flashcards para ver estatísticas</p>
            </div>
        `;
    }
    
    const topRevisados = document.getElementById('top-revisados-table');
    if (topRevisados) {
        topRevisados.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                    <svg class="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <p class="text-lg font-medium">Nenhum dado disponível</p>
                    <p class="text-sm">Comece a revisar seus flashcards</p>
                </td>
            </tr>
        `;
    }
}

function updateEstatisticasGerais() {
    const totalCards = allFlashcards.length;
    const now = new Date();
    
    const revisoesHoje = allFlashcards.filter(card => {
        if (!card.nextReview) return false;
        const reviewDate = card.nextReview instanceof Date ? card.nextReview : card.nextReview.toDate();
        return reviewDate <= now;
    }).length;
    
    const totalReviews = allFlashcards.reduce((sum, card) => sum + (card.totalReviews || 0), 0);
    const totalCorrect = allFlashcards.reduce((sum, card) => sum + (card.correctCount || 0), 0);
    const taxaAcerto = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;
    
    const nivelMedio = Math.round(allFlashcards.reduce((sum, card) => sum + (card.reviewLevel || 0), 0) / totalCards);

    document.getElementById('stats-total-cards').textContent = totalCards;
    document.getElementById('stats-revisoes-hoje').textContent = revisoesHoje;
    document.getElementById('stats-taxa-acerto').textContent = `${taxaAcerto}%`;
    document.getElementById('stats-nivel-medio').textContent = nivelMedio;
}

function renderDistribuicaoNiveis() {
    const container = document.getElementById('nivel-distribution');
    if (!container) return;
    
    const niveisCount = Array(10).fill(0);
    allFlashcards.forEach(card => {
        const nivel = Math.min(card.reviewLevel || 0, 9);
        niveisCount[nivel]++;
    });
    
    const maxCount = Math.max(...niveisCount);
    
    niveisCount.forEach((count, nivel) => {
        if (count === 0 && nivel > 0) return;
        
        const percentage = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
        const barWidth = Math.max(10, percentage);
        
        let nivelColor = 'bg-red-500';
        if (nivel >= 5) nivelColor = 'bg-green-500';
        else if (nivel >= 2) nivelColor = 'bg-blue-500';
        
        const bar = document.createElement('div');
        bar.className = 'flex items-center';
        bar.innerHTML = `
            <div class="w-16 text-sm font-medium text-gray-700">Nível ${nivel}</div>
            <div class="flex-1 ml-2">
                <div class="h-6 bg-gray-200 rounded-full overflow-hidden">
                    <div class="h-full ${nivelColor} rounded-full transition-all duration-500" 
                         style="width: ${barWidth}%"></div>
                </div>
            </div>
            <div class="w-12 text-right text-sm font-semibold ${nivel >= 5 ? 'text-green-600' : nivel >= 2 ? 'text-blue-600' : 'text-red-600'}">
                ${count}
            </div>
        `;
        container.appendChild(bar);
    });
}

function renderDistribuicaoIdioma() {
    const container = document.getElementById('idioma-distribution');
    if (!container) return;
    
    const idiomasCount = {};
    allFlashcards.forEach(card => {
        const idioma = card.idiomaOriginal || 'Desconhecido';
        idiomasCount[idioma] = (idiomasCount[idioma] || 0) + 1;
    });
    
    const sortedIdiomas = Object.entries(idiomasCount)
        .sort((a, b) => b[1] - a[1]);
    
    const colors = ['bg-blue-100 border-blue-300', 'bg-green-100 border-green-300', 
                    'bg-purple-100 border-purple-300', 'bg-amber-100 border-amber-300',
                    'bg-pink-100 border-pink-300', 'bg-indigo-100 border-indigo-300'];
    
    sortedIdiomas.forEach(([idioma, count], index) => {
        const percentage = Math.round((count / allFlashcards.length) * 100);
        const colorClass = colors[index % colors.length];
        
        const card = document.createElement('div');
        card.className = `rounded-lg border-2 ${colorClass} p-4`;
        card.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <span class="font-bold text-lg text-gray-800">${idioma}</span>
                <span class="text-2xl font-bold text-gray-700">${count}</span>
            </div>
            <div class="text-sm text-gray-600">${percentage}% do total</div>
            <div class="mt-2 h-2 bg-gray-300 rounded-full overflow-hidden">
                <div class="h-full ${colorClass.replace('bg-', 'bg-').replace('-100', '-500').replace(' border', '')} rounded-full" 
                     style="width: ${percentage}%"></div>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderTopRevisados() {
    const tbody = document.getElementById('top-revisados-table');
    if (!tbody) return;
    
    const topCards = [...allFlashcards]
        .filter(card => (card.totalReviews || 0) > 0)
        .sort((a, b) => (b.totalReviews || 0) - (a.totalReviews || 0))
        .slice(0, 10);
    
    if (topCards.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td colspan="7" class="px-6 py-8 text-center text-gray-500">
                <svg class="w-10 h-10 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <p>Nenhum card foi revisado ainda</p>
            </td>
        `;
        tbody.appendChild(tr);
        return;
    }
    
    topCards.forEach((card, index) => {
        const accuracy = card.totalReviews > 0 ? 
            Math.round((card.correctCount / card.totalReviews) * 100) : 0;
        
        let accuracyClass = 'text-gray-600';
        if (accuracy >= 80) accuracyClass = 'text-green-600 font-bold';
        else if (accuracy >= 60) accuracyClass = 'text-blue-600';
        else if (accuracy > 0) accuracyClass = 'text-yellow-600';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm font-medium text-gray-900">${index + 1}</td>
            <td class="px-6 py-4 text-sm">
                <div class="font-medium text-indigo-600">${card.palavraOriginal || 'N/A'}</div>
                <div class="text-gray-500 text-xs">${card.traducao || 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-sm">${card.idiomaOriginal || 'N/A'}</td>
            <td class="px-6 py-4 text-sm font-bold text-gray-800">${card.totalReviews || 0}</td>
            <td class="px-6 py-4 text-sm font-bold text-green-600">${card.correctCount || 0}</td>
            <td class="px-6 py-4 text-sm font-bold ${accuracyClass}">${accuracy}%</td>
            <td class="px-6 py-4 text-sm">
                <span class="px-2 py-1 text-xs rounded-full ${card.reviewLevel >= 5 ? 'bg-green-100 text-green-800' : card.reviewLevel >= 2 ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}">
                    Nível ${card.reviewLevel || 0}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderEstatisticasDetalhadas() {
    const tbody = document.getElementById('detailed-stats-table');
    if (!tbody) return;
    
    const sortedCards = [...allFlashcards].sort((a, b) => {
        const dateA = a.createdAt ? (a.createdAt instanceof Date ? a.createdAt : a.createdAt.toDate()) : new Date(0);
        const dateB = b.createdAt ? (b.createdAt instanceof Date ? b.createdAt : b.createdAt.toDate()) : new Date(0);
        return dateB - dateA;
    });
    
    sortedCards.forEach(card => {
        const totalReviews = card.totalReviews || 0;
        const correctCount = card.correctCount || 0;
        const errorCount = totalReviews - correctCount;
        const accuracy = totalReviews > 0 ? Math.round((correctCount / totalReviews) * 100) : 0;
        
        let createdDate = 'N/A';
        if (card.createdAt) {
            const date = card.createdAt instanceof Date ? card.createdAt : card.createdAt.toDate();
            createdDate = date.toLocaleDateString('pt-BR');
        }
        
        let accuracyClass = 'text-gray-600';
        if (accuracy >= 80) accuracyClass = 'text-green-600 font-bold';
        else if (accuracy >= 60) accuracyClass = 'text-blue-600';
        else if (accuracy > 0) accuracyClass = 'text-yellow-600';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm font-medium text-indigo-600">${card.palavraOriginal || 'N/A'}</td>
            <td class="px-6 py-4 text-sm">${card.idiomaOriginal || 'N/A'} → ${card.idiomaTraducao || 'N/A'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${createdDate}</td>
            <td class="px-6 py-4 text-sm font-medium">${totalReviews}</td>
            <td class="px-6 py-4 text-sm font-medium text-green-600">${correctCount}</td>
            <td class="px-6 py-4 text-sm font-medium text-red-600">${errorCount}</td>
            <td class="px-6 py-4 text-sm font-bold ${accuracyClass}">${accuracy}%</td>
            <td class="px-6 py-4 text-sm">
                <span class="px-2 py-1 text-xs rounded-full ${card.consecutiveCorrect >= 2 ? 'bg-green-100 text-green-800 font-bold' : 'bg-gray-100 text-gray-800'}">
                    ${card.consecutiveCorrect || 0}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// =================== ADICIONAR CARDS ===================
async function saveFlashcard(cardData) {
    try {
        if (!cardData.palavraOriginal || !cardData.traducao || !cardData.exemplos) {
            throw new Error("Dados incompletos do card");
        }
        
        if (!cardData.outrasOpcoes || cardData.outrasOpcoes.length === 0) {
            cardData.outrasOpcoes = await getOutrasOpcoes(cardData.traducao);
        }
        
        const newCard = {
            idiomaOriginal: cardData.idiomaOriginal || "Inglês",
            palavraOriginal: cardData.palavraOriginal,
            idiomaTraducao: cardData.idiomaTraducao || "Português",
            traducao: cardData.traducao,
            outrasOpcoes: cardData.outrasOpcoes || [],
            exemplos: Array.isArray(cardData.exemplos) ? cardData.exemplos : [],
            reviewLevel: 0,
            consecutiveCorrect: 0,
            lastAnswerCorrect: true,
            nextReview: Timestamp.fromDate(getNextReviewDate(0)),
            createdAt: Timestamp.now(),
            totalReviews: 0,
            correctCount: 0,
            askReverse: false
        };
        
        await addDoc(flashcardsCollectionRef, newCard);
        return true;
    } catch (err) {
        console.error("Erro ao salvar card:", err);
        return false;
    }
}

async function getOutrasOpcoes(traducaoAtual, limite = 3) {
    try {
        if (!flashcardsCollectionRef || allFlashcards.length === 0) {
            return ["Alternativa A", "Alternativa B", "Alternativa C"];
        }
        
        const opcoesDisponiveis = allFlashcards
            .filter(card => card.traducao !== traducaoAtual)
            .map(card => card.traducao)
            .filter((value, index, self) => self.indexOf(value) === index);
        
        const selecionadas = [...opcoesDisponiveis]
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(limite, opcoesDisponiveis.length));
        
        while (selecionadas.length < limite) {
            selecionadas.push(`Alternativa ${selecionadas.length + 1}`);
        }
        
        return selecionadas;
    } catch (err) {
        console.error("Erro ao buscar opções:", err);
        return ["Alternativa 1", "Alternativa 2", "Alternativa 3"];
    }
}

// =================== AUTENTICAÇÃO ===================
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        const userDisplay = document.getElementById('user-display');
        const userIdDisplay = document.getElementById('user-id-display');
        
        if (userDisplay) userDisplay.textContent = user.displayName || "Anônimo";
        if (userIdDisplay) userIdDisplay.textContent = user.uid.substring(0, 8) + "...";

        flashcardsCollectionRef = collection(db, "users", user.uid, "flashcards");
        
        setupRealtimeListener();
        showView('view-home');
    } else {
        showView('view-login');
    }
    hideLoading();
});

function setupRealtimeListener() {
    if (!flashcardsCollectionRef) return;

    onSnapshot(flashcardsCollectionRef, (snapshot) => {
        allFlashcards = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            if (data.nextReview && data.nextReview.toDate) {
                data.nextReview = data.nextReview.toDate();
            }
            allFlashcards.push(data);
        });
        
        if (!document.getElementById('view-biblioteca').classList.contains('hidden')) {
            renderLibrary();
        }
        if (!document.getElementById('view-revisao').classList.contains('hidden')) {
            loadNextCard();
        }
        if (!document.getElementById('view-estatisticas').classList.contains('hidden')) {
            renderEstatisticas();
        }
    }, (error) => {
        console.error("Erro no listener Firebase:", error);
        showMessage('revisao-message', 'Erro ao carregar cards', 'error');
    });
}

// =================== EVENT LISTENERS ===================
document.addEventListener('DOMContentLoaded', () => {
    // Botão de login Google
    const btnLoginGoogle = document.getElementById('btn-login-google');
    if (btnLoginGoogle) {
        btnLoginGoogle.onclick = () => {
            btnLoginGoogle.disabled = true;
            btnLoginGoogle.innerHTML = `
                <svg class="animate-spin w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Entrando...
            `;
            
            signInWithPopup(auth, new GoogleAuthProvider())
                .catch(err => {
                    console.error("Erro no login:", err);
                    btnLoginGoogle.disabled = false;
                    btnLoginGoogle.innerHTML = `
                        <svg class="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 48 48">
                            <path d="M24 9.5c3.2 0 5.8 1.1 7.7 2.9l5.1-5.1C33.7 3.5 29.2 1 24 1 15.6 1 8.5 5.5 4.7 12.3l6.5 5c1.7-5.1 6.6-8.8 12.8-8.8z" fill="#EA4335"/><path d="M46.7 24.5c0-1.7-.1-3.3-.4-4.9H24v9.2h12.5c-.6 3.1-2.4 5.7-4.9 7.5l6.7 5.2c4.1-3.8 6.5-9.3 6.5-15.5z" fill="#4285F4"/><path d="M10.2 29.7c-.5-1.5-.7-3.1-.7-4.7s.2-3.2.7-4.7l-6.5-5.1C3.4 17.5 3 20.9 3 24.5s.4 7 1.2 10.3l6-5.1z" fill="#FBBC05"/><path d="M24 47.9c6.4 0 11.9-2.1 15.9-5.7l-6.7-5.2c-2.3 1.5-5.2 2.4-9.2 2.4-6.2 0-11.2-4-13.1-9.5l-6.5 5.1c3.8 6.8 11.1 11.3 18.5 11.3z" fill="#34A853"/>
                        </svg>
                        Entrar com Google
                    `;
                    showMessage('login-message', 'Erro no login. Tente novamente.', 'error');
                });
        };
    }
    
    // Botão de logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = () => {
            if (confirm("Tem certeza que deseja sair?")) {
                signOut(auth).catch(err => {
                    console.error("Erro no logout:", err);
                });
            }
        };
    }
    
    // Botão de copiar JSON
    const btnCopiarJson = document.getElementById('btn-copiar-json');
    if (btnCopiarJson) {
        btnCopiarJson.onclick = () => {
            const jsonText = document.getElementById('json-exemplo').textContent;
            navigator.clipboard.writeText(jsonText).then(() => {
                const btn = btnCopiarJson;
                const originalText = btn.innerHTML;
                btn.innerHTML = `
                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    Copiado!
                `;
                btn.classList.add('bg-green-100', 'text-green-700');
                btn.classList.remove('bg-indigo-100', 'text-indigo-700');
                
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('bg-green-100', 'text-green-700');
                    btn.classList.add('bg-indigo-100', 'text-indigo-700');
                }, 2000);
            }).catch(err => {
                console.error('Erro ao copiar:', err);
                showMessage('automatico-message', 'Erro ao copiar. Tente novamente.', 'error');
            });
        };
    }
    
    // Navegação
    const btnHomeAdicionar = document.getElementById('btn-home-adicionar');
    if (btnHomeAdicionar) btnHomeAdicionar.onclick = () => showView('view-add-menu');
    
    const btnHomeRevisar = document.getElementById('btn-home-revisar');
    if (btnHomeRevisar) btnHomeRevisar.onclick = () => showView('view-revisao');
    
    const btnHomeBiblioteca = document.getElementById('btn-home-biblioteca');
    if (btnHomeBiblioteca) btnHomeBiblioteca.onclick = () => showView('view-biblioteca');
    
    const btnAddManual = document.getElementById('btn-add-manual');
    if (btnAddManual) btnAddManual.onclick = () => showView('view-add-manual');
    
    const btnAddAutomatico = document.getElementById('btn-add-automatico');
    if (btnAddAutomatico) btnAddAutomatico.onclick = () => showView('view-add-automatico');
    
    // Botões de voltar
    document.querySelectorAll('[id^="btn-back-from-"]').forEach(btn => {
        if (btn.id === 'btn-back-from-estatisticas') {
            btn.onclick = () => showView('view-biblioteca');
        } else {
            btn.onclick = () => showView('view-home');
        }
    });
    
    const btnBackFromAddMenu = document.getElementById('btn-back-from-add-menu');
    if (btnBackFromAddMenu) btnBackFromAddMenu.onclick = () => showView('view-home');
    
    // Botão de limpar biblioteca
    const btnLimparBiblioteca = document.getElementById('btn-limpar-biblioteca');
    if (btnLimparBiblioteca) {
        btnLimparBiblioteca.onclick = limparBiblioteca;
    }
    
    // Botão de estatísticas
    const btnEstatisticas = document.getElementById('btn-estatisticas');
    if (btnEstatisticas) {
        btnEstatisticas.onclick = () => {
            showView('view-estatisticas');
            renderEstatisticas();
        };
    }
    
    // Formulário manual
    const formAddManual = document.getElementById('form-add-manual');
    if (formAddManual) {
        formAddManual.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = formAddManual.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
            
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `
                    <svg class="animate-spin w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Salvando...
                `;
            }

            const idiomaOriginal = document.getElementById('manual-idioma-original')?.value.trim() || '';
            const palavraOriginal = document.getElementById('manual-palavra')?.value.trim() || '';
            const idiomaTraducao = document.getElementById('manual-idioma-traducao')?.value.trim() || '';
            const traducao = document.getElementById('manual-traducao')?.value.trim() || '';
            const exemplosStr = document.getElementById('manual-exemplos')?.value.trim() || '';
            const outrasOpcoesStr = document.getElementById('manual-outras-opcoes')?.value.trim() || '';

            if (!idiomaOriginal || !palavraOriginal || !idiomaTraducao || !traducao) {
                showMessage('manual-message', 'Preencha todos os campos obrigatórios.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
                return;
            }

            const exemplos = exemplosStr.split(';').map(s => s.trim()).filter(Boolean);
            if (exemplos.length === 0) {
                showMessage('manual-message', 'Adicione pelo menos um exemplo (separados por ";").', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
                return;
            }

            const outrasOpcoes = outrasOpcoesStr.split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(opcao => opcao !== traducao);

            const cardData = { 
                idiomaOriginal, 
                palavraOriginal,
                idiomaTraducao,
                traducao, 
                exemplos,
                outrasOpcoes: outrasOpcoes.length > 0 ? outrasOpcoes : undefined
            };

            const success = await saveFlashcard(cardData);
            
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
            
            if (success) {
                showMessage('manual-message', '✅ Flashcard salvo com sucesso!', 'success');
                formAddManual.reset();
            } else {
                showMessage('manual-message', '❌ Erro ao salvar. Tente novamente.', 'error');
            }
        });
    }
    
    // Flip ao clicar no card
    const flashcardContainer = document.getElementById('flashcard-container');
    if (flashcardContainer) {
        flashcardContainer.onclick = () => {
            if (!isFlipped && currentCard) {
                flipCard(false);
            }
        };
    }
    
    // Digitação
    const typingSubmitBtn = document.getElementById('typing-submit-btn');
    if (typingSubmitBtn) {
        typingSubmitBtn.onclick = () => {
            const input = document.getElementById('typing-input')?.value.trim() || '';
            const msg = document.getElementById('typing-message');
            if (!input || !msg) return;

            let correct;
            if (currentDirection === 'forward') {
                correct = input.toLowerCase() === (currentCard?.traducao || '').toLowerCase();
            } else {
                correct = input.toLowerCase() === (currentCard?.palavraOriginal || '').toLowerCase();
            }
            
            msg.textContent = correct ? "Correto!" : `Errado. Resposta: ${currentDirection === 'forward' ? currentCard?.traducao : currentCard?.palavraOriginal}`;
            msg.className = correct ? "text-green-600 font-bold" : "text-red-600 font-bold";
            flipCard(correct);
            updateReviewLevel(correct);
        };
    }
    
    // Enter na digitação
    const typingInput = document.getElementById('typing-input');
    if (typingInput) {
        typingInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const typingSubmitBtn = document.getElementById('typing-submit-btn');
                if (typingSubmitBtn) typingSubmitBtn.click();
            }
        });
    }
    
    // Próximo card
    const btnNextCard = document.getElementById('btn-next-card');
    if (btnNextCard) {
        btnNextCard.onclick = () => {
            loadNextCard();
            updateReviewCounter();
        };
    }
    
    // Nova rodada
    const btnNovaRodada = document.getElementById('btn-nova-rodada');
    if (btnNovaRodada) {
        btnNovaRodada.onclick = startForcedReviewSession;
    }
    
    // JSON em massa
    const btnProcessarJson = document.getElementById('btn-processar-json');
    if (btnProcessarJson) {
        btnProcessarJson.onclick = async () => {
            if (isProcessingJSON) return;
            
            const txt = document.getElementById('automatico-json-input');
            const msg = document.getElementById('automatico-message');
            const btn = btnProcessarJson;
            
            if (!txt || !msg || !btn) return;
            
            const jsonText = txt.value.trim();
            if (!jsonText) {
                showMessage('automatico-message', 'Cole o JSON primeiro.', 'error');
                return;
            }
            
            isProcessingJSON = true;
            const originalBtnText = btn.innerHTML;
            
            btn.disabled = true;
            btn.innerHTML = `
                <svg class="animate-spin w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processando...
            `;
            
            try {
                const arr = JSON.parse(jsonText);
                if (!Array.isArray(arr)) throw new Error("Deve ser um array");

                let ok = 0;
                let errors = [];
                
                for (let i = 0; i < arr.length; i++) {
                    const c = arr[i];
                    if (c.palavraOriginal && c.traducao && Array.isArray(c.exemplos)) {
                        const cardData = {
                            ...c,
                            outrasOpcoes: c.outrasOpcoes && Array.isArray(c.outrasOpcoes) 
                                ? c.outrasOpcoes.filter(op => op !== c.traducao) 
                                : undefined
                        };
                        
                        await saveFlashcard(cardData);
                        ok++;
                        
                        if (i % 2 === 0 || i === arr.length - 1) {
                            msg.textContent = `Processando... ${ok}/${arr.length} cards`;
                            msg.className = "text-blue-600 font-bold";
                        }
                    } else {
                        errors.push(`Card ${i + 1} inválido: ${c.palavraOriginal || 'sem nome'}`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
                
                let resultMsg = `✅ ${ok} cards salvos com sucesso!`;
                if (errors.length > 0) {
                    resultMsg += ` (${errors.length} erros)`;
                    console.warn("Erros no processamento:", errors);
                }
                
                showMessage('automatico-message', resultMsg, 'success', 5000);
                txt.value = "";
                
                setTimeout(() => {
                    showView('view-home');
                }, 2000);
                
            } catch (err) {
                console.error("Erro no JSON:", err);
                showMessage('automatico-message', `JSON inválido: ${err.message}`, 'error', 5000);
            } finally {
                isProcessingJSON = false;
                btn.disabled = false;
                btn.innerHTML = originalBtnText;
            }
        };
    }
});