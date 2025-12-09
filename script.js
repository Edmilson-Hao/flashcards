// script.js - VERSÃO COMPLETA CORRIGIDA

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
// No topo do arquivo, verifique se está importando writeBatch:
import { 
    getFirestore, 
    doc, 
    updateDoc, 
    onSnapshot, 
    collection, 
    Timestamp, 
    addDoc, 
    deleteDoc,
    writeBatch,
    getDocs  // Adicione esta se não existir
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
    // Esconde todas as views e mostra apenas a solicitada
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = document.getElementById(viewId);
    if (view) {
        view.classList.remove('hidden');
    }

    // Remover classes de background de resultado (se houver)
    document.body.classList.remove('correct-bg', 'incorrect-bg');

    // Garantir que o viewport mostre o topo da nova view (resolve o scroll residual)
    // Compatível com navegadores antigos e modernos
    try {
        window.scrollTo(0, 0);
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;
    } catch (e) {
        /* ignore */
    }

    // Quando entrar na view-revisao, configurar sessão e carregar primeiro card
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

function updateReviewCounter() {
    const cardsRemainingElement = document.getElementById('cards-remaining');
    const cardsDueTodayElement = document.getElementById('cards-due-today');
    const sessionCountElement = document.getElementById('session-count');
    const revisaoMessage = document.getElementById('revisao-message');
    
    if (!cardsRemainingElement || !cardsDueTodayElement || !sessionCountElement) return;
    
    const cardsRemaining = Math.max(0, currentReviewSession.length - currentSessionIndex);
    cardsRemainingElement.textContent = cardsRemaining;
    sessionCountElement.textContent = sessionReviewCount;
    
    const now = new Date();
    const totalDue = allFlashcards.filter(c => {
        if (!c.nextReview) return false;
        const reviewDate = c.nextReview instanceof Date ? c.nextReview : c.nextReview.toDate();
        return reviewDate <= now;
    }).length;
    
    cardsDueTodayElement.textContent = totalDue;
    
    const message = isForcedSession ? 
        `Sessão forçada | ${currentReviewSession.length} card(s) para revisar` :
        `${totalDue} card(s) vencidos hoje | Sessão: ${sessionReviewCount} revisados`;
    
    if (revisaoMessage) {
        revisaoMessage.textContent = message;
    }
}

// =================== RESUMO DA REVISÃO ===================

function showReviewSummary() {
    console.log("Mostrando resumo da revisão...");
    
    // Obter estatísticas da sessão
    const statsStr = sessionStorage.getItem('reviewStats');
    const stats = statsStr ? JSON.parse(statsStr) : { total: 0, correct: 0, cards: [] };
    
    const totalCards = stats.total || 0;
    const correctCards = stats.correct || 0;
    const incorrectCards = totalCards - correctCards;
    const accuracy = totalCards > 0 ? Math.round((correctCards / totalCards) * 100) : 0;
    
    console.log("Estatísticas da sessão:", { totalCards, correctCards, accuracy });
    
    // Obter a view de revisão
    const reviewView = document.getElementById('view-revisao');
    if (!reviewView) {
        console.error("View de revisão não encontrada");
        return;
    }
    
    // Determinar mensagem baseada na precisão
    let emoji, message, colorClass;
    if (accuracy >= 90) {
        emoji = '🏆';
        message = 'Excelente! Seu domínio está impressionante!';
        colorClass = 'text-green-400';
    } else if (accuracy >= 75) {
        emoji = '🎯';
        message = 'Muito bom! Continue assim!';
        colorClass = 'text-green-300';
    } else if (accuracy >= 60) {
        emoji = '👍';
        message = 'Bom trabalho! A prática leva à perfeição.';
        colorClass = 'text-yellow-300';
    } else if (accuracy >= 40) {
        emoji = '😐';
        message = 'Continue praticando! Você está melhorando.';
        colorClass = 'text-yellow-400';
    } else {
        emoji = '💪';
        message = 'Não desista! Cada erro é uma oportunidade de aprender.';
        colorClass = 'text-red-300';
    }
    
    // Criar HTML do resumo (sem onclick inline)
    const summaryHTML = `
        <div class="w-full max-w-2xl mx-auto p-6">
            <div class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-8 text-center">
                <div class="text-6xl mb-4">${emoji}</div>
                <h2 class="text-2xl font-bold text-white mb-2">Revisão Concluída!</h2>
                <p class="text-slate-300 mb-8">${message}</p>
                
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <div class="bg-slate-900 rounded-lg p-4">
                        <div class="text-3xl font-bold text-indigo-400">${totalCards}</div>
                        <div class="text-sm text-slate-400 mt-1">Cards Revisados</div>
                    </div>
                    
                    <div class="bg-slate-900 rounded-lg p-4">
                        <div class="text-3xl font-bold text-green-400">${correctCards}</div>
                        <div class="text-sm text-slate-400 mt-1">Acertos</div>
                    </div>
                    
                    <div class="bg-slate-900 rounded-lg p-4">
                        <div class="text-3xl font-bold text-red-400">${incorrectCards}</div>
                        <div class="text-sm text-slate-400 mt-1">Erros</div>
                    </div>
                    
                    <div class="bg-slate-900 rounded-lg p-4">
                        <div class="text-3xl font-bold ${colorClass}">${accuracy}%</div>
                        <div class="text-sm text-slate-400 mt-1">Precisão</div>
                    </div>
                </div>
                
                <div class="mb-8">
                    <div class="text-lg font-semibold text-slate-300 mb-2">Progresso da Sessão</div>
                    <div class="w-full bg-slate-700 rounded-full h-4">
                        <div class="bg-gradient-to-r from-indigo-500 to-purple-500 h-4 rounded-full transition-all duration-500" 
                             style="width: ${accuracy}%"></div>
                    </div>
                    <div class="flex justify-between text-sm text-slate-400 mt-2">
                        <span>0%</span>
                        <span>${accuracy}%</span>
                        <span>100%</span>
                    </div>
                </div>
                
                <div class="text-sm text-slate-400 mb-8">
                    <p class="mb-1">⏰ Próxima revisão programada para amanhã</p>
                    <p>📊 ${isForcedSession ? 'Sessão forçada concluída' : 'Revisão diária completa'}</p>
                </div>
                
                <div class="flex flex-col sm:flex-row gap-4 justify-center">
                    <button id="btn-return-home" 
                            class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-300 shadow-md">
                        Voltar ao Menu Principal
                    </button>
                    <button id="btn-new-session" 
                            class="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition duration-300 shadow-md border border-slate-600">
                        Nova Sessão de Revisão
                    </button>
                </div>
            </div>
            
            <div class="text-center mt-8">
                <button id="btn-back-summary" 
                        class="text-slate-400 hover:text-white font-medium transition duration-200 inline-flex items-center">
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                    </svg>
                    Voltar para Home
                </button>
            </div>
        </div>
    `;
    
    // Atualizar a view
    reviewView.innerHTML = summaryHTML;
    
    // Adicionar event listeners após o HTML ser inserido
    setTimeout(() => {
        // Botão "Voltar ao Menu Principal"
        const btnReturnHome = document.getElementById('btn-return-home');
        if (btnReturnHome) {
            btnReturnHome.addEventListener('click', returnToHome);
        }
        
        // Botão "Nova Sessão de Revisão"
        const btnNewSession = document.getElementById('btn-new-session');
        if (btnNewSession) {
            btnNewSession.addEventListener('click', startNewReviewSession);
        }
        
        // Botão "Voltar para Home" (no rodapé)
        const btnBackSummary = document.getElementById('btn-back-summary');
        if (btnBackSummary) {
            btnBackSummary.addEventListener('click', () => {
                returnToHome();
            });
        }
    }, 100);
    
    // Limpar estatísticas da sessão
    sessionStorage.removeItem('reviewStats');
}

function returnToHome() {
    console.log("Voltando para home...");
    
    // Limpar estado da sessão forçada
    isForcedSession = false;
    
    // Resetar botão de nova rodada se existir
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
    
    // Limpar estatísticas
    sessionStorage.removeItem('reviewStats');
    
    // Voltar para home
    showView('view-home');
}

function startNewReviewSession() {
    console.log("Iniciando nova sessão de revisão...");
    
    // Resetar estado
    isForcedSession = false;
    currentSessionIndex = 0;
    sessionReviewCount = 0;
    
    // Limpar estatísticas
    sessionStorage.removeItem('reviewStats');
    
    // Resetar botão de nova rodada
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
    
    // Recarregar a view de revisão
    showView('view-revisao');
    
    // Pequeno delay para garantir que o DOM foi atualizado
    setTimeout(() => {
        setupReviewSession();
        loadNextCard();
    }, 100);
}

function loadNextCard() {
    if (isReviewLoop) {
        console.log("Loop de revisão ativo, ignorando...");
        return;
    }
    
    isReviewLoop = true;
    
    console.log("=== CARREGANDO PRÓXIMO CARD ===");
    console.log("Índice atual:", currentSessionIndex);
    console.log("Total na sessão:", currentReviewSession.length);
    
    // Verificar se terminou a sessão
    if (currentSessionIndex >= currentReviewSession.length) {
        console.log("Fim da sessão de revisão");
        
        if (sessionReviewCount > 0) {
            // Mostrar resumo após um pequeno delay
            setTimeout(() => {
                showReviewSummary();
            }, 500);
        } else {
            // Nenhum card revisado - mostrar mensagem vazia
            const cardFront = document.getElementById('card-palavra-front');
            const revisaoMessage = document.getElementById('revisao-message');
            const quizOptions = document.getElementById('quiz-options-container');
            const resultControls = document.getElementById('review-result-controls');
            
            if (cardFront) {
                cardFront.textContent = isForcedSession ? 
                    "🎉 Todos os cards revisados!" : 
                    "✨ Nenhum card para revisar hoje!";
            }
            if (revisaoMessage) {
                revisaoMessage.textContent = isForcedSession ? 
                    "Sessão forçada concluída com sucesso!" : 
                    "Volte amanhã para novas revisões programadas.";
            }
            if (quizOptions) quizOptions.classList.add('hidden');
            if (resultControls) resultControls.classList.add('hidden');
        }
        
        isReviewLoop = false;
        return;
    }
    
    // OBTER O NOVO CARD
    currentCard = currentReviewSession[currentSessionIndex];
    console.log("Novo card obtido:", {
        id: currentCard.id,
        palavra: currentCard.palavraOriginal,
        traducao: currentCard.traducao
    });
    
    // Atualizar índices
    currentSessionIndex++;
    sessionReviewCount++;
    
    // Resetar estado
    isFlipped = false;
    document.body.classList.remove('correct-bg', 'incorrect-bg');
    
    // Limpar estado visual dos botões
    document.querySelectorAll('.quiz-option-btn').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('selected-correct', 'selected-incorrect', 'pulse-animation');
        btn.style.animation = '';
        btn.style.transform = '';
        btn.style.boxShadow = '';
    });
    
    // Resetar flashcard
    const flashcardContainer = document.getElementById('flashcard-container');
    if (flashcardContainer) {
        flashcardContainer.classList.remove('is-flipped');
        flashcardContainer.style.pointerEvents = 'auto';
    }
    
    // Esconder controles de resultado
    const resultControls = document.getElementById('review-result-controls');
    if (resultControls) resultControls.classList.add('hidden');
    
    // Atualizar direção
    currentDirection = currentCard.askReverse ? 'reverse' : 'forward';
    console.log("Direção do card:", currentDirection);
    
    // Atualizar interface do card
    updateCardInterface();
    
    // Configurar modo de teste
    const shouldUseTyping = currentCard.consecutiveCorrect >= 2 && currentCard.lastAnswerCorrect;
    const quizOptions = document.getElementById('quiz-options-container');
    const quizTyping = document.getElementById('quiz-typing-container');
    const typingInput = document.getElementById('typing-input');
    
    if (shouldUseTyping && quizTyping && typingInput) {
        quizTyping.classList.remove('hidden');
        if (quizOptions) quizOptions.classList.add('hidden');
        typingInput.value = '';
        setTimeout(() => typingInput.focus(), 100);
    } else {
        if (quizTyping) quizTyping.classList.add('hidden');
        if (quizOptions) {
            quizOptions.classList.remove('hidden');
            // Configurar múltipla escolha
            setTimeout(() => {
                setupMultipleChoice();
            }, 50);
        }
    }
    
    updateReviewCounter();
    
    console.log("=== CARD CARREGADO COM SUCESSO ===");
    
    // Resetar loop protection
    setTimeout(() => {
        isReviewLoop = false;
    }, 300);
}

function setupTestMode() {
    // Esta função agora é redundante - o código foi movido para loadNextCard
    // Mantenha apenas por compatibilidade
    console.log("setupTestMode chamada - usando lógica inline");
}

function initSessionStats() {
    const stats = {
        total: 0,
        correct: 0,
        startTime: new Date().toISOString(),
        cards: [],
        // gravar o total inicial da sessão para a contagem regressiva
        initialDue: Array.isArray(currentReviewSession) && currentReviewSession.length > 0
            ? currentReviewSession.length
            : null
    };
    // Se não tivemos currentReviewSession disponível, calcule fallback (cards vencidos hoje)
    if (stats.initialDue === null) {
        try {
            const now = new Date();
            const totalDue = allFlashcards.filter(c => {
                if (!c.nextReview) return false;
                const reviewDate = c.nextReview instanceof Date ? c.nextReview : (c.nextReview.toDate ? c.nextReview.toDate() : new Date(c.nextReview));
                return reviewDate <= now;
            }).length;
            stats.initialDue = totalDue;
        } catch (e) {
            stats.initialDue = 0;
        }
    }

    sessionStorage.setItem('reviewStats', JSON.stringify(stats));
    console.log("Estatísticas da sessão inicializadas - initialDue:", stats.initialDue);

    // Atualizar #review-counter para iniciar com initialDue
    const reviewCounterEl = document.querySelector('#review-counter');
    if (reviewCounterEl) {
        reviewCounterEl.textContent = String(Math.max(0, stats.initialDue || 0));
    }
}

function updateSessionStats(isCorrect) {
    try {
        const statsStr = sessionStorage.getItem('reviewStats');
        let stats = statsStr ? JSON.parse(statsStr) : { total: 0, correct: 0, cards: [], initialDue: null };
        
        stats.total = (stats.total || 0) + 1;
        if (isCorrect) {
            stats.correct = (stats.correct || 0) + 1;
        }
        
        // Registrar este card
        if (currentCard) {
            stats.cards = stats.cards || [];
            stats.cards.push({
                id: currentCard.id,
                palavra: currentCard.palavraOriginal,
                traducao: currentCard.traducao,
                correct: isCorrect,
                timestamp: new Date().toISOString(),
                direction: currentDirection
            });
            
            // Manter apenas os últimos 50 cards para não ficar muito grande
            if (stats.cards.length > 50) {
                stats.cards = stats.cards.slice(-50);
            }
        }

        // Garantir que exista initialDue (fallback para calcular se necessário)
        if (typeof stats.initialDue !== 'number' || stats.initialDue === null) {
            try {
                const now = new Date();
                const totalDue = allFlashcards.filter(c => {
                    if (!c.nextReview) return false;
                    const reviewDate = c.nextReview instanceof Date ? c.nextReview : (c.nextReview.toDate ? c.nextReview.toDate() : new Date(c.nextReview));
                    return reviewDate <= now;
                }).length;
                stats.initialDue = totalDue;
            } catch (e) {
                stats.initialDue = 0;
            }
        }
        
        sessionStorage.setItem('reviewStats', JSON.stringify(stats));
        console.log("Estatísticas atualizadas - Total:", stats.total, "Corretas:", stats.correct, "InitialDue:", stats.initialDue);

        // Atualizar elemento #review-counter em tempo real (contagem regressiva)
        const reviewCounterEl = document.querySelector('#review-counter');
        if (reviewCounterEl) {
            const remaining = Math.max(0, (stats.initialDue || 0) - (stats.correct || 0));
            reviewCounterEl.textContent = String(remaining);
        }
    } catch (error) {
        console.error("Erro ao atualizar estatísticas:", error);
    }
}

function showNoCardsMessage() {
    const reviewView = document.getElementById('view-revisao');
    if (!reviewView) return;
    
    reviewView.innerHTML = `
        <div class="w-full max-w-2xl mx-auto p-6">
            <div class="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-8 text-center">
                <div class="text-6xl mb-4">📚</div>
                <h2 class="text-2xl font-bold text-white mb-4" id="no-cards-title">
                    ${isForcedSession ? 'Todos os Cards Revisados!' : 'Nenhum Card para Revisar Hoje!'}
                </h2>
                
                <p class="text-slate-300 mb-6" id="no-cards-message">
                    ${isForcedSession ? 
                        'Você revisou todos os cards disponíveis na sessão forçada.' : 
                        'Todos os seus cards estão em dia! Volte amanhã para novas revisões.'}
                </p>
                
                <div class="text-sm text-slate-400 mb-8">
                    <p class="mb-2">📊 Total de cards no sistema: ${allFlashcards.length}</p>
                    <p>⏰ Próxima revisão programada para amanhã</p>
                </div>
                
                <div class="flex flex-col sm:flex-row gap-4 justify-center">
                    <button id="btn-home-from-empty" 
                            class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-300 shadow-md">
                        Voltar ao Menu
                    </button>
                    
                    ${!isForcedSession ? `
                    <button id="btn-force-session" 
                            class="bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-300 shadow-md">
                        Iniciar Sessão Forçada
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    // Adicionar event listeners após o HTML ser inserido
    setTimeout(() => {
        // Botão "Voltar ao Menu"
        const btnHomeFromEmpty = document.getElementById('btn-home-from-empty');
        if (btnHomeFromEmpty) {
            btnHomeFromEmpty.addEventListener('click', () => {
                showView('view-home');
            });
        }
        
        // Botão "Iniciar Sessão Forçada"
        const btnForceSession = document.getElementById('btn-force-session');
        if (btnForceSession) {
            btnForceSession.addEventListener('click', startForcedReviewSession);
        }
    }, 100);
}

function setupReviewSession() {
    console.log("=== INICIANDO SESSÃO DE REVISÃO ===");

    const now = new Date();

    if (isForcedSession) {
        currentReviewSession = allFlashcards
            .filter(card => card.reviewLevel < 9)
            .sort(() => 0.5 - Math.random());
        console.log("Sessão forçada:", currentReviewSession.length, "cards");
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
        console.log("Sessão normal:", currentReviewSession.length, "cards vencidos");
    }

    currentSessionIndex = 0;
    sessionReviewCount = 0;

    // Inicializar estatísticas DA SESSÃO agora que currentReviewSession foi definido
    initSessionStats();

    updateReviewCounter();

    if (currentReviewSession.length === 0) {
        console.log("Nenhum card para revisar");
        return false;
    }

    console.log("Sessão configurada com sucesso");
    return true;
}

function getFallbackOption(direction, respostaCorreta, opcoesExistentes) {
    // Converter para strings para comparação
    const respostaStr = String(respostaCorreta).trim().toLowerCase();
    const existentesStr = opcoesExistentes.map(op => String(op).trim().toLowerCase());
    
    const opcoesPortugues = [
        "Casa", "Tempo", "Água", "Fogo", "Terra", 
        "Ar", "Luz", "Amor", "Vida", "Dia", 
        "Noite", "Sol", "Lua", "Mar", "Rio"
    ];
    
    const opcoesIngles = [
        "House", "Time", "Water", "Fire", "Earth", 
        "Air", "Light", "Love", "Life", "Day", 
        "Night", "Sun", "Moon", "Sea", "River"
    ];
    
    const opcoes = direction === 'forward' ? opcoesPortugues : opcoesIngles;
    
    // Tentar encontrar uma opção que não existe e não é a resposta correta
    for (const opcao of opcoes) {
        const opcaoStr = opcao.toLowerCase();
        const existe = existentesStr.includes(opcaoStr);
        const ehCorreta = opcaoStr === respostaStr;
        
        if (!existe && !ehCorreta) {
            return opcao;
        }
    }
    
    return null;
}

// =================== FUNÇÕES DE ATUALIZAÇÃO DO CARD ===================

function updateCardInterface() {
    const cardIdiomaFront = document.getElementById('card-idioma-front');
    const cardPalavraFront = document.getElementById('card-palavra-front');
    const cardTraducaoBack = document.getElementById('card-traducao-back');
    
    if (!currentCard) {
        console.error("currentCard não definido em updateCardInterface");
        return;
    }
    
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
        
        console.log("Interface atualizada:", {
            idioma: cardIdiomaFront.textContent,
            frente: cardPalavraFront.textContent,
            verso: cardTraducaoBack.textContent
        });
    } else {
        console.error("Elementos do card não encontrados");
    }
    
    // Atualizar exemplos
    updateExamples();
}

function updateExamples() {
    const exemplosList = document.getElementById('card-exemplos-back');
    if (!exemplosList) {
        console.error("Elemento exemplosList não encontrado");
        return;
    }
    
    exemplosList.innerHTML = '';
    const exemplos = currentCard?.exemplos || [];
    
    if (exemplos.length > 0) {
        exemplos.forEach((ex, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${ex}`;
            li.className = 'text-sm text-slate-300 mb-1 pl-2';
            exemplosList.appendChild(li);
        });
        console.log(`${exemplos.length} exemplos carregados`);
    } else {
        const li = document.createElement('li');
        li.textContent = "Nenhum exemplo disponível";
        li.className = 'text-sm text-slate-500 italic';
        exemplosList.appendChild(li);
        console.log("Nenhum exemplo disponível para este card");
    }
}

function checkAnswer(answer, buttonElement) {
    if (isFlipped || !currentCard) {
        console.log("Card já virado ou não existe");
        return;
    }
    
    console.log("=== VERIFICANDO RESPOSTA ===");
    console.log("Card:", currentCard.palavraOriginal);
    console.log("Resposta clicada:", answer);
    
    // Converter para string com segurança
    const answerStr = String(answer).trim().toLowerCase();
    
    let correct;
    let respostaCorretaTexto;
    
    // Verificar se temos resposta no dataset do botão
    if (buttonElement?.dataset.correctAnswer) {
        respostaCorretaTexto = String(buttonElement.dataset.correctAnswer).trim();
        const respostaStr = respostaCorretaTexto.toLowerCase();
        correct = answerStr === respostaStr;
        console.log("Usando resposta do botão:", respostaCorretaTexto, "Resultado:", correct);
    } else {
        // Fallback: usar a lógica padrão
        if (currentDirection === 'forward') {
            respostaCorretaTexto = currentCard.traducao ? String(currentCard.traducao).trim() : '';
            correct = answerStr === respostaCorretaTexto.toLowerCase();
        } else {
            respostaCorretaTexto = currentCard.palavraOriginal ? String(currentCard.palavraOriginal).trim() : '';
            correct = answerStr === respostaCorretaTexto.toLowerCase();
        }
        console.log("Usando lógica padrão:", respostaCorretaTexto, "Resultado:", correct);
    }
    
    // Desabilitar todos os botões
    document.querySelectorAll('.quiz-option-btn').forEach(btn => {
        btn.disabled = true;
    });
    
    // Feedback visual
    if (buttonElement) {
        if (correct) {
            buttonElement.classList.add('selected-correct');
            console.log("✅ RESPOSTA CORRETA!");
        } else {
            buttonElement.classList.add('selected-incorrect');
            console.log("❌ RESPOSTA INCORRETA!");
            
            // Destacar a resposta correta
            const respostaCorretaStr = respostaCorretaTexto.toLowerCase();
            document.querySelectorAll('.quiz-option-btn').forEach(btn => {
                const btnText = String(btn.textContent).trim().toLowerCase();
                if (btnText === respostaCorretaStr) {
                    btn.classList.add('selected-correct');
                    console.log("Resposta correta destacada:", btn.textContent);
                }
            });
        }
    }
    
    // Atualizar estatísticas
    updateSessionStats(correct);
    
    // SE ACERTOU: carregar próximo card automaticamente
    if (correct) {
        console.log("Carregando próximo card em 800ms...");
        setTimeout(() => {
            updateReviewLevel(correct);
            loadNextCard();
        }, 800);
    } else {
        // SE ERROU: virar o card para mostrar a resposta correta
        console.log("Mostrando resposta correta...");
        setTimeout(() => {
            flipCard(correct);
            updateReviewLevel(correct);
        }, 1000);
    }
}

function setupMultipleChoice() {
    const buttons = Array.from(document.querySelectorAll('.quiz-option-btn'));
    if (!buttons.length || !currentCard) return;

    const correctAnswer = (currentDirection === 'forward' ? (currentCard.traducao || '') : (currentCard.palavraOriginal || '')).trim();
    // Começar com as opções erradas definidas no próprio card (se houver)
    let wrongs = Array.isArray(currentCard.outrasOpcoes) ? currentCard.outrasOpcoes.map(safeString).filter(s => s) : [];

    // Pool de opções vindas de outros cards
    const pool = allFlashcards
        .filter(c => c.id !== currentCard.id)
        .map(c => (currentDirection === 'forward' ? c.traducao : c.palavraOriginal))
        .map(safeString)
        .filter(s => s && s.toLowerCase() !== correctAnswer.toLowerCase());

    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

    // Construir lista de opções garantindo unicidade
    const options = [correctAnswer];
    // adicionar do `outrasOpcoes` do card
    for (const w of wrongs) {
        if (options.length >= buttons.length) break;
        if (!options.some(o => o.toLowerCase() === w.toLowerCase())) options.push(w);
    }
    // completar a partir do pool
    shuffle(pool);
    for (const p of pool) {
        if (options.length >= buttons.length) break;
        if (!options.some(o => o.toLowerCase() === p.toLowerCase())) options.push(p);
    }

    // fallback usando getFallbackOption se ainda faltar
    while (options.length < buttons.length) {
        const fb = getFallbackOption(currentDirection, correctAnswer, options);
        if (!fb) break;
        options.push(fb);
    }

    // embaralhar e aplicar nas buttons
    shuffle(options);
    buttons.forEach((btn, i) => {
        const text = options[i] || '';
        btn.textContent = text;
        // armazena a resposta correta para que checkAnswer possa usá-la
        btn.dataset.correctAnswer = correctAnswer;
        btn.dataset.index = i;
        btn.disabled = false;
        btn.classList.remove('selected-correct', 'selected-incorrect', 'pulse-animation');
        btn.style.animation = '';
        btn.style.transform = '';
        btn.style.boxShadow = '';
        // garantir handler -> chama checkAnswer quando clicado
        btn.onclick = () => checkAnswer(String(text).trim(), btn);
    });
}

// Função auxiliar para garantir que valores são strings
function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

// Função para limpar dados dos cards
function sanitizeCardData(card) {
    if (!card) return null;
    
    return {
        ...card,
        palavraOriginal: safeString(card.palavraOriginal),
        traducao: safeString(card.traducao),
        idiomaOriginal: safeString(card.idiomaOriginal),
        idiomaTraducao: safeString(card.idiomaTraducao),
        outrasOpcoes: Array.isArray(card.outrasOpcoes) ? 
            card.outrasOpcoes.map(safeString).filter(s => s !== '') : [],
        exemplos: Array.isArray(card.exemplos) ? 
            card.exemplos.map(safeString).filter(s => s !== '') : []
    };
}

function debugCurrentCard() {
    console.log("=== DEBUG CURRENT CARD ===");
    console.log("currentCard:", currentCard);
    console.log("ID:", currentCard?.id);
    console.log("Palavra:", currentCard?.palavraOriginal);
    console.log("Tradução:", currentCard?.traducao);
    console.log("Direção:", currentDirection);
    console.log("All flashcards:", allFlashcards.length);
    
    // Verificar se o card atual existe no array
    const found = allFlashcards.find(c => c.id === currentCard?.id);
    console.log("Card encontrado no array:", !!found);
    
    // Verificar os botões atuais
    const buttons = document.querySelectorAll('.quiz-option-btn');
    console.log("Botões encontrados:", buttons.length);
    buttons.forEach((btn, i) => {
        console.log(`Botão ${i}:`, btn.textContent, "Correct?", btn.dataset.isCorrect);
    });
    console.log("=== DEBUG END ===");
}

// Chame esta função no console do navegador quando tiver o problema

function createConfettiEffect(element, isCorrect) {
    if (!element) return;
    
    const rect = element.getBoundingClientRect();
    const colors = isCorrect ? 
        ['#10b981', '#34d399', '#a7f3d0'] : 
        ['#3b82f6', '#60a5fa', '#93c5fd'];
    
    for (let i = 0; i < 8; i++) {
        const confetti = document.createElement('div');
        confetti.style.position = 'fixed';
        confetti.style.width = '6px';
        confetti.style.height = '6px';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.borderRadius = '50%';
        confetti.style.left = (rect.left + rect.width / 2) + 'px';
        confetti.style.top = (rect.top + rect.height / 2) + 'px';
        confetti.style.zIndex = '1000';
        confetti.style.pointerEvents = 'none';
        
        document.body.appendChild(confetti);
        
        // Animação
        const angle = Math.random() * Math.PI * 2;
        const velocity = 2 + Math.random() * 3;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;
        
        let opacity = 1;
        let x = 0;
        let y = 0;
        
        const animate = () => {
            opacity -= 0.02;
            x += vx;
            y += vy + 0.1; // gravidade
            
            confetti.style.transform = `translate(${x}px, ${y}px)`;
            confetti.style.opacity = opacity;
            
            if (opacity > 0) {
                requestAnimationFrame(animate);
            } else {
                confetti.remove();
            }
        };
        
        requestAnimationFrame(animate);
    }
}

function flipCard(correct) {
    if (isFlipped) return;
    
    isFlipped = true;
    const flashcardContainer = document.getElementById('flashcard-container');
    if (flashcardContainer) {
        flashcardContainer.classList.add('is-flipped');
        flashcardContainer.style.pointerEvents = 'none';
    }
    
    // Mudar background
    document.body.classList.add(correct ? 'correct-bg' : 'incorrect-bg');
    
    // Mostrar controles de resultado
    const resultControls = document.getElementById('review-result-controls');
    const quizOptions = document.getElementById('quiz-options-container');
    const quizTyping = document.getElementById('quiz-typing-container');
    
    if (resultControls) resultControls.classList.remove('hidden');
    if (quizOptions) quizOptions.classList.add('hidden');
    if (quizTyping) quizTyping.classList.add('hidden');
    
    // Atualizar contador
    updateReviewCounter();
}

async function updateReviewLevel(correct) {
    if (!currentCard || !currentCard.id) return;
    
    const newConsecutiveCorrect = correct ? 
        (currentCard.consecutiveCorrect || 0) + 1 : 
        0;
    
    const newLevel = correct ? 
        Math.min((currentCard.reviewLevel || 0) + 1, 9) : 
        Math.max(0, (currentCard.reviewLevel || 0) - 1);
    
    const nextDate = getNextReviewDate(newLevel);
    
    const updates = {
        reviewLevel: newLevel,
        consecutiveCorrect: newConsecutiveCorrect,
        lastAnswerCorrect: correct,
        nextReview: Timestamp.fromDate(nextDate),
        lastReviewed: Timestamp.now(),
        totalReviews: (currentCard.totalReviews || 0) + 1,
        correctCount: (currentCard.correctCount || 0) + (correct ? 1 : 0)
    };

    try {
        if (!flashcardsCollectionRef) {
            throw new Error("Não conectado ao Firestore");
        }
        
        await updateDoc(doc(flashcardsCollectionRef, currentCard.id), updates);
        
        // Atualizar card local
        Object.assign(currentCard, updates);
        
        setTimeout(() => {
            updateReviewCounter();
        }, 100);
    } catch (err) {
        console.error("Erro ao atualizar revisão:", err);
        
        // Se offline, salvar para sincronização depois
        if (!navigator.onLine) {
            console.log("[Offline] Salvando mudança para sincronização depois");
            offlineSync.addChange('updateReview', {
                cardId: currentCard.id,
                updates: updates
            });
            Sway.showToast('✓ Salvo localmente. Será sincronizado quando voltar online.', 'info', 3000);
        } else {
            showMessage('revisao-message', 'Erro ao salvar revisão', 'error');
        }
    }
}

function startForcedReviewSession() {
    Sway.confirm(
        "Iniciar nova rodada de revisão?\n\nIsso revisará todos os cards disponíveis, independentemente da data de revisão.",
        "Nova Rodada de Revisão"
    ).then(confirmed => {
        if (!confirmed) return;
        
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
    });    
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
                <div class="text-xs text-gray-500 mt-1">Acertos: ${card.consecutiveCorrect || 0} seg.</div>
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
            Sway.confirm(
                "Excluir este flashcard permanentemente?",
                "Excluir Card"
            ).then(async (confirmed) => {
                if (!confirmed) return;
                
                try {
                    await deleteDoc(doc(flashcardsCollectionRef, btn.dataset.id));
                    Sway.showToast('Card excluído com sucesso!', 'success', 2000);
                } catch (err) {
                    Sway.showToast('Erro ao excluir card', 'error', 2000);
                }
            });
        };
    });
}

// =================== LIMPAR BIBLIOTECA ===================
async function limparBiblioteca() {
    console.log("Iniciando limpeza da biblioteca...");
    
    if (allFlashcards.length === 0) {
        Sway.showToast('A biblioteca já está vazia.', 'info', 3000);
        return;
    }
    
    try {
        // PRIMEIRA CONFIRMAÇÃO
        const primeiraConfirmacao = await Sway.confirm(
            "🚨 ATENÇÃO: Esta ação irá excluir TODOS os flashcards permanentemente.\n\n" +
            "Esta ação NÃO pode ser desfeita.\n\n" +
            "Deseja continuar?",
            "Limpar Biblioteca"
        );
        
        if (!primeiraConfirmacao) {
            console.log("Usuário cancelou na primeira confirmação");
            return;
        }
        
        // SEGUNDA CONFIRMAÇÃO
        const segundaConfirmacao = await Sway.confirm(
            "⚠️ Você tem CERTEZA ABSOLUTA?\n\n" +
            "Todos os seus dados de aprendizado serão perdidos.\n\n" +
            "Esta é a última chance para cancelar.",
            "Confirmação Final"
        );
        
        if (!segundaConfirmacao) {
            Sway.showToast('Operação cancelada. Nada foi excluído.', 'warning', 3000);
            return;
        }
        
        // TERCEIRA CONFIRMAÇÃO COM INPUT
        const textoConfirmacao = await Sway.prompt(
            "Digite 'LIMPAR' (em maiúsculas) para confirmar a exclusão de TODOS os flashcards:",
            "",
            "Confirmação por Texto"
        );
        
        if (textoConfirmacao !== 'LIMPAR') {
            Sway.showToast('Operação cancelada. Texto incorreto.', 'warning', 3000);
            return;
        }
        
        // MOSTRAR LOADING
        const loadingToast = Sway.showToast('Excluindo todos os flashcards...', 'info', 0);
        
        // EXCLUSÃO EM LOTE
        console.log(`Iniciando exclusão de ${allFlashcards.length} cards...`);
        
        // Usar batch para exclusão eficiente
        const batch = writeBatch(db);
        let contador = 0;
        
        allFlashcards.forEach(card => {
            if (card.id) {
                const cardRef = doc(flashcardsCollectionRef, card.id);
                batch.delete(cardRef);
                contador++;
            }
        });
        
        console.log(`Preparados ${contador} cards para exclusão`);
        
        // Executar o batch
        await batch.commit();
        
        // Fechar loading toast
        if (loadingToast && loadingToast.close) {
            loadingToast.close();
        }
        
        // Mostrar sucesso
        Sway.showToast(`✅ Biblioteca limpa com sucesso! ${contador} flashcards excluídos.`, 'success', 5000);
        
        // O listener do Firestore (onSnapshot) irá automaticamente atualizar o array allFlashcards
        // e renderizar as views vazias
        
        // Forçar atualização imediata da interface
        setTimeout(() => {
            // Atualizar array local
            allFlashcards = [];
            currentReviewSession = [];
            currentSessionIndex = 0;
            sessionReviewCount = 0;
            currentCard = null;
            
            // Atualizar views
            renderLibrary();
            
            if (!document.getElementById('view-estatisticas').classList.contains('hidden')) {
                renderEstatisticas();
            }
            
            if (!document.getElementById('view-revisao').classList.contains('hidden')) {
                loadNextCard();
            }
            
            console.log("Limpeza concluída e interface atualizada");
        }, 500);
        
    } catch (error) {
        console.error("❌ Erro ao limpar biblioteca:", error);
        Sway.showToast('❌ Erro ao limpar biblioteca. Tente novamente.', 'error', 5000);
    }
}

async function limparBibliotecaSimples() {
    if (allFlashcards.length === 0) {
        Sway.showToast('A biblioteca já está vazia.', 'info', 3000);
        return;
    }
    
    const confirmado = await Sway.confirm(
        `Excluir todos os ${allFlashcards.length} flashcards?`,
        "Limpar Biblioteca"
    );
    
    if (!confirmado) return;
    
    try {
        const loading = Sway.showToast('Excluindo...', 'info', 0);
        
        // Excluir um por um (mais lento mas mais confiável para debug)
        for (const card of allFlashcards) {
            if (card.id) {
                await deleteDoc(doc(flashcardsCollectionRef, card.id));
                console.log(`Excluído: ${card.palavraOriginal}`);
            }
        }
        
        if (loading && loading.close) loading.close();
        
        Sway.showToast(`✅ ${allFlashcards.length} cards excluídos!`, 'success', 4000);
        
        // Forçar recarregamento
        setTimeout(() => {
            allFlashcards = [];
            renderLibrary();
        }, 1000);
        
    } catch (error) {
        console.error("Erro:", error);
        Sway.showToast('Erro ao excluir', 'error', 3000);
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
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
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
        // Sanitizar dados antes de salvar
        const sanitizedData = sanitizeCardData(cardData);
        
        if (!sanitizedData.palavraOriginal || !sanitizedData.traducao) {
            throw new Error("Dados incompletos do card");
        }
        
        // Garantir que exemplos é um array
        if (!Array.isArray(sanitizedData.exemplos) || sanitizedData.exemplos.length === 0) {
            throw new Error("Adicione pelo menos um exemplo");
        }
        
        const newCard = {
            idiomaOriginal: sanitizedData.idiomaOriginal || "Inglês",
            palavraOriginal: sanitizedData.palavraOriginal,
            idiomaTraducao: sanitizedData.idiomaTraducao || "Português",
            traducao: sanitizedData.traducao,
            outrasOpcoes: sanitizedData.outrasOpcoes || [],
            exemplos: sanitizedData.exemplos,
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
            // Usar palavras genéricas em vez de "Alternativa X"
            const palavrasFallback = ["Opção A", "Opção B", "Opção C", "Resposta X", "Resposta Y"];
            return palavrasFallback.slice(0, limite);
        }
        
        const opcoesDisponiveis = allFlashcards
            .filter(c => c.traducao && c.traducao.trim().toLowerCase() !== traducaoAtual.trim().toLowerCase())
            .map(card => card.traducao)
            .filter((value, index, self) => self.indexOf(value) === index);
        
        const selecionadas = [...opcoesDisponiveis]
            .sort(() => 0.5 - Math.random())
            .slice(0, Math.min(limite, opcoesDisponiveis.length));
        
        // Se não tiver opções suficientes, completar com palavras aleatórias
        const palavrasPortugues = ["Casa", "Tempo", "Água", "Fogo", "Terra", "Ar", "Luz", "Amor"];
        while (selecionadas.length < limite) {
            const palavraAleatoria = palavrasPortugues[Math.floor(Math.random() * palavrasPortugues.length)];
            if (!selecionadas.includes(palavraAleatoria) && palavraAleatoria !== traducaoAtual) {
                selecionadas.push(palavraAleatoria);
            }
        }
        
        return selecionadas;
    } catch (err) {
        console.error("Erro ao buscar opções:", err);
        return ["Opção 1", "Opção 2", "Opção 3"];
    }
}

// =================== AUTENTICAÇÃO ===================
onAuthStateChanged(auth, (user) => {
    currentUser = user;

    const doAfterDom = async () => {
        if (user) {
            document.querySelector("#view-login > div").style.display = 'none';
            document.querySelector("#view-login").style.display = 'none';
            const userDisplay = document.getElementById('user-display');
            const userIdDisplay = document.getElementById('user-id-display');

            if (userDisplay) userDisplay.textContent = user.displayName || user.email || 'Usuário';
            if (userIdDisplay) userIdDisplay.textContent = user.uid || '';

            flashcardsCollectionRef = collection(db, "users", user.uid, "flashcards");

            // start listener and show home AFTER DOM is ready
            setupRealtimeListener();
            showView('view-home');
        } else {
            // not logged -> show login
            showView('view-login');
        }

        hideLoading();
        // ensure top of page
        try { window.scrollTo(0,0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0; } catch(e){}
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doAfterDom, { once: true });
    } else {
        doAfterDom();
    }
});

function setupRealtimeListener() {
    if (!flashcardsCollectionRef) {
        console.error("Collection ref não definida!");
        return;
    }

    console.log("Iniciando listener do Firestore...");
    
    onSnapshot(flashcardsCollectionRef, (snapshot) => {
        console.log(`Snapshot recebido: ${snapshot.size} documentos`);
        
        allFlashcards = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            if (data.nextReview && data.nextReview.toDate) {
                data.nextReview = data.nextReview.toDate();
            }
            allFlashcards.push(data);
        });
        
        console.log(`Total carregado: ${allFlashcards.length} cards`);
        
        // ... resto do código ...
        
    }, (error) => {
        console.error("Erro no listener Firebase:", error);
        Sway.showToast('Erro ao carregar cards', 'error', 3000);
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
                    Sway.showToast('Erro no login. Tente novamente.', 'error', 4000);
                });
        };
    }
    
    // Botão de logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.onclick = () => {
            Sway.confirm(
                "Tem certeza que deseja sair?",
                "Sair da Conta"
            ).then((confirmed) => {
                if (confirmed) {
                    signOut(auth).catch(err => {
                        console.error("Erro no logout:", err);
                        Sway.showToast('Erro ao sair. Tente novamente.', 'error', 3000);
                    });
                    window.location.reload();
                }
            });
        };
    }
    
    // Botão de copiar JSON
    const btnCopiarJson = document.getElementById('btn-copiar-json');
    if (btnCopiarJson) {
        btnCopiarJson.onclick = () => {
            const jsonText = document.getElementById('json-exemplo').textContent;
            navigator.clipboard.writeText(jsonText).then(() => {
                // MOSTRAR TOAST DO SWAY
                Sway.showToast('JSON copiado para a área de transferência!', 'success', 2000);
                
                // Manter o feedback visual no botão também (opcional)
                const btn = btnCopiarJson;
                const originalText = btn.innerHTML;
                btn.innerHTML = `
                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>
                    Copiado!
                `;
                btn.classList.add('bg-green-600', 'text-white');
                btn.classList.remove('bg-indigo-600', 'text-white');
                
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('bg-green-600', 'text-white');
                    btn.classList.add('bg-indigo-600', 'text-white');
                }, 2000);
            }).catch(err => {
                console.error('Erro ao copiar:', err);
                // USAR SWAY PARA ERRO
                Sway.showToast('Erro ao copiar. Tente novamente.', 'error', 3000);
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
    // No final do script.js, verifique se o event listener está assim:
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
                Sway.showToast('Preencha todos os campos obrigatórios.', 'error', 3000);
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
                return;
            }

            const exemplos = exemplosStr.split(';').map(s => s.trim()).filter(Boolean);
            if (exemplos.length === 0) {
                Sway.showToast('Adicione pelo menos um exemplo (separados por ";").', 'error', 3000);
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
                Sway.showToast('✅ Flashcard salvo com sucesso!', 'success', 3000);
                formAddManual.reset();
            } else {
                Sway.showToast('❌ Erro ao salvar. Tente novamente.', 'error', 3000);
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
    // No event listener do btn-next-card, adicione:
    // Próximo card
    const btnNextCard = document.getElementById('btn-next-card');
    if (btnNextCard) {
        btnNextCard.onclick = () => {
            // Forçar reset completo dos botões
            document.querySelectorAll('.quiz-option-btn').forEach(btn => {
                btn.classList.remove('selected-correct', 'selected-incorrect', 'pulse-animation');
                btn.style.animation = '';
                btn.style.transform = '';
                btn.disabled = false;
            });

            // Esconder controles de resultado
            const resultControls = document.getElementById('review-result-controls');
            if (resultControls) resultControls.classList.add('hidden');

            // Mostrar opções do quiz
            const quizOptions = document.getElementById('quiz-options-container');
            if (quizOptions) quizOptions.classList.remove('hidden');

            // Garantir que o estado de "flipped" não bloqueie ações
            isFlipped = false;

            // Remover visual de flip sem animação para não revelar o verso
            const flashcardContainer = document.getElementById('flashcard-container');
            if (flashcardContainer) {
                // Desativar transições temporariamente
                const prevTransition = flashcardContainer.style.transition;
                flashcardContainer.style.transition = 'none';

                // Remover classe que aplica o flip (remove a face de trás imediatamente)
                flashcardContainer.classList.remove('is-flipped');
                flashcardContainer.style.pointerEvents = 'auto';

                // Esconder conteúdo do verso enquanto atualizamos (garante que nada apareça)
                const backEls = flashcardContainer.querySelectorAll('#card-traducao-back, #card-exemplos-back, .card-back');
                backEls.forEach(el => el.style.visibility = 'hidden');

                // Forçar reflow para aplicar imediatamente as mudanças
                void flashcardContainer.offsetHeight;

                // Restaurar transições e visibilidade logo em seguida
                setTimeout(() => {
                    flashcardContainer.style.transition = prevTransition || '';
                    backEls.forEach(el => el.style.visibility = '');
                }, 50);
            }

            // Carregar próximo card e atualizar contadores
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
                Sway.showToast('Cole o JSON primeiro.', 'error', 3000);
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

                Sway.showToast(resultMsg, 'success', 5000);
                txt.value = "";
                
                setTimeout(() => {
                    showView('view-home');
                }, 2000);
                
            } catch (err) {
                console.error("Erro no JSON:", err);
                Sway.showToast(`JSON inválido: ${err.message}`, 'error', 5000);
            } finally {
                isProcessingJSON = false;
                btn.disabled = false;
                btn.innerHTML = originalBtnText;
            }
        };
    }
});

// =================== VERIFICAÇÃO DE FUNÇÕES GLOBAIS ===================

// Garantir que funções importantes estão no escopo global
window.returnToHome = returnToHome;
window.startNewReviewSession = startNewReviewSession;
window.showReviewSummary = showReviewSummary;
window.showNoCardsMessage = showNoCardsMessage;
window.startForcedReviewSession = startForcedReviewSession;
window.showView = showView;

// Funções que podem ser chamadas por event listeners inline
if (typeof window !== 'undefined') {
    // Lista de funções que precisam estar disponíveis globalmente
    const globalFunctions = [
        'returnToHome',
        'startNewReviewSession', 
        'showReviewSummary',
        'showNoCardsMessage',
        'startForcedReviewSession',
        'showView',
        'setupReviewSession',
        'loadNextCard',
        'checkAnswer',
        'flipCard',
        'updateReviewLevel'
    ];
    
    globalFunctions.forEach(funcName => {
        if (typeof window[funcName] === 'undefined' && typeof eval(funcName) !== 'undefined') {
            window[funcName] = eval(funcName);
        }
    });
}

// =================== SWAY MODAL SYSTEM ===================

const Sway = {
    // Modal principal
    showModal(options) {
        return new Promise((resolve) => {
            const modal = document.getElementById('sway-modal');
            const title = document.getElementById('sway-title');
            const message = document.getElementById('sway-message');
            const body = document.getElementById('sway-body');
            const footer = document.getElementById('sway-footer');
            const closeBtn = document.getElementById('sway-close');
            const overlay = document.getElementById('sway-overlay');
            const input = document.getElementById('sway-input');
            
            // Configurar título e mensagem
            title.textContent = options.title || '';
            message.textContent = options.message || '';
            
            // Configurar input se necessário
            if (options.type === 'prompt') {
                input.classList.remove('hidden');
                input.value = options.defaultValue || '';
                input.placeholder = options.placeholder || 'Digite aqui...';
                input.focus();
            } else {
                input.classList.add('hidden');
            }
            
            // Limpar botões anteriores
            footer.innerHTML = '';
            
            // Criar botões
            if (options.buttons && options.buttons.length > 0) {
                options.buttons.forEach(btn => {
                    const button = document.createElement('button');
                    button.textContent = btn.text;
                    button.className = `sway-btn ${btn.class || 'sway-btn-primary'}`;
                    
                    if (btn.isPrimary) {
                        button.classList.add('sway-btn-primary');
                    }
                    
                    button.onclick = () => {
                        const result = options.type === 'prompt' ? input.value : btn.value || true;
                        this.hideModal();
                        resolve(result);
                    };
                    
                    footer.appendChild(button);
                });
            } else {
                // Botão padrão OK
                const okButton = document.createElement('button');
                okButton.textContent = 'OK';
                okButton.className = 'sway-btn sway-btn-primary';
                okButton.onclick = () => {
                    const result = options.type === 'prompt' ? input.value : true;
                    this.hideModal();
                    resolve(result);
                };
                footer.appendChild(okButton);
            }
            
            // Fechar com ESC
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    this.hideModal();
                    resolve(options.type === 'prompt' ? null : false);
                }
            };
            
            // Fechar ao clicar no overlay
            overlay.onclick = () => {
                this.hideModal();
                resolve(options.type === 'prompt' ? null : false);
            };
            
            // Fechar com botão X
            closeBtn.onclick = () => {
                this.hideModal();
                resolve(options.type === 'prompt' ? null : false);
            };
            
            // Mostrar modal
            modal.classList.remove('hidden');
            document.addEventListener('keydown', handleEscape);
            
            // Guardar event listener para remover depois
            modal._escapeHandler = handleEscape;
        });
    },
    
    hideModal() {
        const modal = document.getElementById('sway-modal');
        modal.classList.add('hidden');
        
        if (modal._escapeHandler) {
            document.removeEventListener('keydown', modal._escapeHandler);
            delete modal._escapeHandler;
        }
    },
    
    // Alert simplificado
    alert(message, title = 'Atenção') {
        return this.showModal({
            title,
            message,
            buttons: [{ text: 'OK', value: true }]
        });
    },
    
    // Confirm simplificado
    confirm(message, title = 'Confirmação') {
        return this.showModal({
            title,
            message,
            buttons: [
                { text: 'Cancelar', class: 'sway-btn-secondary', value: false },
                { text: 'Confirmar', class: 'sway-btn-primary', value: true }
            ]
        });
    },
    
    // Prompt simplificado
    prompt(message, defaultValue = '', title = 'Entrada') {
        return this.showModal({
            type: 'prompt',
            title,
            message,
            defaultValue,
            buttons: [
                { text: 'Cancelar', class: 'sway-btn-secondary', value: null },
                { text: 'OK', class: 'sway-btn-primary', value: true }
            ]
        });
    },
    
    // Toast/Notificação
    showToast(message, type = 'info', duration = 4000) {
        const toast = document.getElementById('sway-toast');
        const toastMessage = document.getElementById('sway-toast-message');
        const toastIcon = document.getElementById('sway-toast-icon');
        const closeBtn = document.getElementById('sway-toast-close');
        
        // Configurar mensagem
        toastMessage.textContent = message;
        
        // Configurar ícone baseado no tipo
        let iconSvg, iconClass;
        switch(type) {
            case 'success':
                iconSvg = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
                iconClass = 'sway-icon-success';
                break;
            case 'error':
                iconSvg = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                iconClass = 'sway-icon-error';
                break;
            case 'warning':
                iconSvg = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.346 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>';
                iconClass = 'sway-icon-warning';
                break;
            default:
                iconSvg = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
                iconClass = 'sway-icon-info';
        }
        
        toastIcon.innerHTML = iconSvg;
        toastIcon.className = iconClass;
        
        // Fechar toast
        const closeToast = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 300);
        };
        
        closeBtn.onclick = closeToast;
        
        // Mostrar toast
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto-fechar
        if (duration > 0) {
            setTimeout(closeToast, duration);
        }
        
        return {
            close: closeToast
        };
    }
};

// Tornar Sway global
window.Sway = Sway;

// Função para substituir showMessage por Sway.showToast
function swayMessage(elementId, message, type = 'info', duration = 3000) {
    // Se o elemento existir, ainda podemos atualizá-lo
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = message;
        element.classList.remove('hidden');
    }
    
    // Mostrar toast também
    Sway.showToast(message, type, duration);
}

async function debugFirestoreState() {
    try {
        console.log("=== DEBUG FIRESTORE ===");
        console.log("Usuário logado:", currentUser?.uid);
        console.log("Collection ref:", flashcardsCollectionRef?.path);
        console.log("Total local (allFlashcards):", allFlashcards.length);
        
        // Verificar diretamente no Firestore
        if (flashcardsCollectionRef) {
            const snapshot = await getDocs(flashcardsCollectionRef);
            console.log("Total no Firestore:", snapshot.size);
            
            snapshot.forEach(doc => {
                console.log(`Card ${doc.id}:`, doc.data().palavraOriginal);
            });
        }
        console.log("=== FIM DEBUG ===");
    } catch (error) {
        console.error("Erro no debug:", error);
    }
}

/*
// Adicione um botão de debug temporário
const debugBtn = document.createElement('button');
debugBtn.textContent = "Debug DB";
debugBtn.style.position = 'fixed';
debugBtn.style.bottom = '60px';
debugBtn.style.left = '10px';
debugBtn.style.zIndex = '9999';
debugBtn.style.padding = '5px 10px';
debugBtn.style.background = '#333';
debugBtn.style.color = 'white';
debugBtn.style.border = 'none';
debugBtn.style.borderRadius = '5px';
debugBtn.onclick = debugFirestoreState;
document.body.appendChild(debugBtn);
*/

// =================== PWA SERVICE WORKER REGISTRATION ===================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/flashcards/sw.js', {
      scope: '/flashcards/'
    })
    .then(registration => {
      console.log('[PWA] Service Worker registrado:', registration);
      
      // Verificar updates periodicamente
      setInterval(() => {
        registration.update();
      }, 60000); // A cada minuto
      
      // Notificar quando há uma nova versão
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            Sway.showToast('Atualização disponível! Recarregue para aplicar.', 'info', 5000);
          }
        });
      });
    })
    .catch(error => {
      console.error('[PWA] Erro ao registrar Service Worker:', error);
    });
  });
  
  // Ouvir mensagens do Service Worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'OFFLINE') {
      Sway.showToast('⚠️ Você está offline. Funcionalidade limitada.', 'warning', 3000);
    }
    if (event.data.type === 'ONLINE') {
      Sway.showToast('✅ Conexão restaurada. Sincronizando...', 'success', 3000);
    }
  });
}

// =================== DETECÇÃO DE CONEXÃO ===================

window.addEventListener('online', () => {
  console.log('[PWA] Conexão restaurada');
  Sway.showToast('✅ Você está online novamente', 'success', 3000);
  
  // Tentar sincronizar dados
  if ('serviceWorker' in navigator && 'ServiceWorkerContainer' in window) {
    navigator.serviceWorker.controller?.postMessage({
      type: 'SYNC',
      action: 'syncFlashcards'
    });
  }
});

window.addEventListener('offline', () => {
  console.log('[PWA] Conexão perdida');
  Sway.showToast('⚠️ Você está offline. Os dados serão salvos localmente.', 'warning', 4000);
});

// =================== INSTALL PROMPT (Para botão "Instalar") ===================

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  
  // Mostrar botão de instalar na home view
  const homeView = document.getElementById('view-home');
  if (homeView && !document.getElementById('btn-install-app')) {
    const installBtn = document.createElement('button');
    installBtn.id = 'btn-install-app';
    installBtn.className = 'text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition duration-300 shadow-md fixed top-4 right-4 z-20 flex items-center';
    installBtn.innerHTML = `
      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
      </svg>
      Instalar App
    `;
    
    installBtn.onclick = async () => {
      if (!deferredPrompt) {
        Sway.showToast('App já instalado ou não disponível', 'info', 3000);
        return;
      }
      
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`Instalação ${outcome === 'accepted' ? 'aceita' : 'rejeitada'}`);
      deferredPrompt = null;
      installBtn.style.display = 'none';
    };
    
    document.body.appendChild(installBtn);
  }
});

window.addEventListener('appinstalled', () => {
  console.log('[PWA] App instalado com sucesso!');
  Sway.showToast('✅ App instalado com sucesso! Você pode usar offline.', 'success', 4000);
  deferredPrompt = null;
  
  const installBtn = document.getElementById('btn-install-app');
  if (installBtn) {
    installBtn.style.display = 'none';
  }
});

// =================== SYNC PENDENTE DE DADOS ===================

class OfflineDataSync {
  constructor() {
    this.pendingChanges = this.loadPendingChanges();
  }

  loadPendingChanges() {
    try {
      return JSON.parse(localStorage.getItem('pendingChanges')) || [];
    } catch (e) {
      return [];
    }
  }

  savePendingChanges() {
    localStorage.setItem('pendingChanges', JSON.stringify(this.pendingChanges));
  }

  addChange(type, data) {
    this.pendingChanges.push({
      type,
      data,
      timestamp: new Date().toISOString()
    });
    this.savePendingChanges();
    console.log('[Offline] Mudança salva para sincronização later:', type);
  }

  async syncWhenOnline() {
    if (!navigator.onLine) {
      console.log('[Offline] Ainda offline, aguardando conexão');
      return;
    }

    console.log('[Offline] Sincronizando', this.pendingChanges.length, 'mudanças pendentes');
    
    for (const change of this.pendingChanges) {
      try {
        if (change.type === 'updateReview') {
          await updateDoc(doc(flashcardsCollectionRef, change.data.cardId), change.data.updates);
        } else if (change.type === 'addCard') {
          await addDoc(flashcardsCollectionRef, change.data);
        }
      } catch (error) {
        console.error('[Offline] Erro ao sincronizar:', error);
        return; // Parar se houver erro
      }
    }

    this.pendingChanges = [];
    this.savePendingChanges();
    console.log('[Offline] Sincronização completa!');
    Sway.showToast('✅ Dados sincronizados com sucesso!', 'success', 3000);
  }
}

const offlineSync = new OfflineDataSync();

// Sincronizar quando voltar online
window.addEventListener('online', () => {
  offlineSync.syncWhenOnline();
});

// Tentar sincronizar ao carregar se há pendências
window.addEventListener('load', () => {
  if (navigator.onLine && offlineSync.pendingChanges.length > 0) {
    setTimeout(() => offlineSync.syncWhenOnline(), 2000);
  }
});