// #################################################################
// ################ CONFIGURAÇÃO E AUTENTICAÇÃO FIREBASE ###########
// #################################################################

// Importa as funções necessárias do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signInWithCustomToken, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, Timestamp, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Variáveis globais de ambiente (fornecidas pelo Canvas)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyA_R9qLO_Cj-b2mLGPPQFZPearLS8_ZL78",
    authDomain: "flashcards-6cc04.firebaseapp.com",
    projectId: "flashcards-6cc04",
    storageBucket: "flashcards-6cc04.firebasestorage.app",
    messagingSenderId: "689024752336",
    appId: "1:689024752336:web:1235587e239187a0ab9cd5",
};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
setLogLevel('Debug'); // Habilita logs para depuração

let currentUserId = null;
let userDataRef = null; // Referência ao documento do usuário (Coleção)
let isAuthReady = false; // Flag para indicar que a autenticação foi processada

// Estrutura de repetição espaçada (Curva de Ebbinghaus simplificada)
const EBBINGHAUS_INTERVALS_DAYS = [0, 1, 2, 4, 7, 15, 30, 90, 180, 365];

/**
 * Gera a próxima data de revisão com base no nível atual.
 * @param {number} currentLevel Nível atual (0 a N)
 * @returns {Date} A próxima data de revisão.
 */
function getNextReviewDate(currentLevel) {
    const level = Math.min(currentLevel, EBBINGHAUS_INTERVALS_DAYS.length - 1);
    const days = EBBINGHAUS_INTERVALS_DAYS[level];
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
}

/**
 * Autentica o usuário usando o token customizado ou anonimamente.
 */
async function authenticateUser() {
    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
            console.log("Login com token customizado concluído.");
        } else {
            // Em ambiente local ou sem token, usa login anônimo
            await signInAnonymously(auth);
            console.log("Login anônimo concluído.");
        }
    } catch (error) {
        console.error("Erro na autenticação inicial:", error);
    }
}

// Observador de estado de autenticação
onAuthStateChanged(auth, (user) => {
    isAuthReady = true; // A autenticação foi processada

    if (user) {
        currentUserId = user.uid;
        // Define o caminho para os dados do usuário
        const userFlashcardPath = `/artifacts/${appId}/users/${currentUserId}/flashcards`;
        userDataRef = doc(db, userFlashcardPath, "data");

        // Atualiza a exibição do usuário
        document.getElementById('user-display').textContent = user.displayName || 'Anônimo';
        document.getElementById('user-id-display').textContent = currentUserId;

        // Tenta carregar os dados/coleção do usuário ou inicializa
        loadUserDataAndNavigate();

    } else {
        currentUserId = null;
        // Se não houver usuário e a autenticação estiver pronta, exibe o login
        showView('view-login');
    }
});

/**
 * Tenta carregar os dados/coleção do usuário ou inicializa.
 */
async function loadUserDataAndNavigate() {
    try {
        const docSnap = await getDoc(userDataRef);

        if (!docSnap.exists()) {
            // Inicializa a coleção/documento do usuário
            const initialData = {
                name: auth.currentUser.displayName || 'Usuário Anônimo',
                email: auth.currentUser.email || 'N/A',
                createdAt: Timestamp.now(),
            };
            await setDoc(userDataRef, initialData);
            console.log("Documento de usuário inicializado.");
        }

        // Inicia o listener de flashcards e navega para a home
        setupFlashcardsListener();
        showView('view-home');

    } catch (error) {
        console.error("Erro ao carregar ou inicializar dados do usuário:", error);
        // Em caso de erro grave, mostra o login
        showView('view-login');
    }
}

// #################################################################
// ################### CONTROLE DE VISUALIZAÇÃO ####################
// #################################################################

const views = document.querySelectorAll('.view');
/**
 * Mostra uma view específica e esconde todas as outras.
 * @param {string} viewId O ID da view a ser exibida (ex: 'view-login').
 */
function showView(viewId) {
    views.forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');
    // Remove as classes de feedback de fundo ao mudar de tela
    document.body.classList.remove('correct-bg', 'incorrect-bg');
    if (viewId === 'view-revisao') {
        loadFlashcardForReview();
    }
    if (viewId === 'view-biblioteca') {
        renderBiblioteca();
    }
}

// #################################################################
// ##################### GERENCIAMENTO DE CARDS ####################
// #################################################################

let allFlashcards = [];
let flashcardsCollectionRef = null;

/**
 * Configura o listener em tempo real para todos os flashcards do usuário.
 */
function setupFlashcardsListener() {
    if (!currentUserId) return;

    const cardsPath = `/artifacts/${appId}/users/${currentUserId}/flashcards/cards`;
    flashcardsCollectionRef = collection(db, cardsPath);

    onSnapshot(flashcardsCollectionRef, (snapshot) => {
        allFlashcards = [];
        snapshot.forEach(doc => {
            const card = doc.data();
            card.id = doc.id;
            if (card.nextReview instanceof Timestamp) {
                card.nextReview = card.nextReview.toDate();
            }
            allFlashcards.push(card);
        });
        console.log(`Total de Flashcards carregados: ${allFlashcards.length}`);

        if (!document.getElementById('view-biblioteca').classList.contains('hidden')) {
            renderBiblioteca();
        }
        if (!document.getElementById('view-revisao').classList.contains('hidden')) {
            loadFlashcardForReview();
        }
    }, (error) => {
        console.error("Erro ao ouvir a coleção de flashcards:", error);
        document.getElementById('biblioteca-message').textContent = 'Erro ao carregar os dados.';
    });
}

/**
 * Salva um novo flashcard no Firestore.
 * @param {object} cardData Dados do flashcard (idioma, palavra, traducao, exemplos).
 */
async function saveFlashcard(cardData) {
    if (!flashcardsCollectionRef) {
        console.error("Coleção de flashcards não inicializada.");
        return false;
    }

    const newCard = {
        ...cardData,
        reviewLevel: 0,
        nextReview: Timestamp.fromDate(getNextReviewDate(0)),
        createdAt: Timestamp.now(),
        // Inicializa contadores
        totalReviews: 0,
        correctCount: 0,
    };

    try {
        await addDoc(flashcardsCollectionRef, newCard);
        return true;
    } catch (error) {
        console.error("Erro ao salvar o flashcard:", error);
        return false;
    }
}

// #################################################################
// ################### LÓGICA DE REVISÃO (EBBINGHAUS) ##############
// #################################################################

let cardsToReview = [];
let currentCard = null;
let isCardFlipped = false;
let correctAnswer = '';

/**
 * Carrega o próximo flashcard para revisão.
 */
function loadFlashcardForReview() {
    document.getElementById('revisao-message').textContent = 'Carregando cards para revisão...';
    document.getElementById('flashcard-container').classList.remove('is-flipped');
    
    // 1. Filtra cards prontos para revisão
    const now = new Date();
    cardsToReview = allFlashcards
        .filter(card => card.nextReview <= now)
        .sort((a, b) => a.nextReview - b.nextReview);

    if (cardsToReview.length === 0) {
        document.getElementById('card-idioma-front').textContent = '';
        document.getElementById('card-palavra-front').textContent = 'Nenhum card para revisar hoje!';
        document.getElementById('revisao-message').textContent = 'Parabéns! Você revisou todos os cards por hoje. Volte mais tarde.';
        document.getElementById('quiz-options-container').classList.add('hidden');
        document.getElementById('quiz-typing-container').classList.add('hidden');
        document.getElementById('review-result-controls').classList.add('hidden');
        return;
    }

    currentCard = cardsToReview[0];
    document.getElementById('revisao-message').textContent = `${cardsToReview.length} card(s) pendente(s) para revisão.`;

    // 2. Reseta o estado do card
    isCardFlipped = false;
    document.body.classList.remove('correct-bg', 'incorrect-bg');
    document.getElementById('review-result-controls').classList.add('hidden');
    document.getElementById('typing-message').textContent = '';

    // 3. Preenche a interface
    correctAnswer = currentCard.traducao;

    // Frente do Card
    document.getElementById('card-idioma-front').textContent = currentCard.idioma;
    document.getElementById('card-palavra-front').textContent = currentCard.palavra;

    // Verso do Card
    document.getElementById('card-traducao-back').textContent = currentCard.traducao;
    const exemplosList = document.getElementById('card-exemplos-back');
    exemplosList.innerHTML = '';
    (Array.isArray(currentCard.exemplos) ? currentCard.exemplos : []).forEach(ex => {
        const li = document.createElement('li');
        li.textContent = ex;
        exemplosList.appendChild(li);
    });


    // 4. Determina o modo de revisão (Quiz ou Digitação)
    const useTypingMode = currentCard.reviewLevel >= 3;

    if (useTypingMode) {
        // Modo Digitação
        document.getElementById('quiz-options-container').classList.add('hidden');
        document.getElementById('quiz-typing-container').classList.remove('hidden');
        document.getElementById('typing-input').value = '';
    } else {
        // Modo Múltipla Escolha
        document.getElementById('quiz-options-container').classList.remove('hidden');
        document.getElementById('quiz-typing-container').classList.add('hidden');
        setupQuizOptions();
    }
}

/**
 * Monta as opções de múltipla escolha.
 */
function setupQuizOptions() {
    const incorrectOptions = allFlashcards
        .filter(card => card.id !== currentCard.id)
        .map(card => card.traducao);

    const shuffledIncorrect = shuffleArray(incorrectOptions).slice(0, 3);
    let allPossibleAnswers = shuffleArray([correctAnswer, ...shuffledIncorrect]);

    while (allPossibleAnswers.length < 4) {
        allPossibleAnswers.push("Opção Falsa " + (Math.random() * 100).toFixed(0));
    }
    allPossibleAnswers = allPossibleAnswers.slice(0, 4);

    const optionButtons = document.querySelectorAll('.quiz-option-btn');
    optionButtons.forEach((btn, index) => {
        btn.textContent = allPossibleAnswers[index];
        btn.disabled = false;
        btn.classList.remove('bg-green-100', 'bg-red-100', 'border-green-500', 'border-red-500');
        btn.classList.add('bg-gray-50', 'border-gray-200');
    });
}

/**
 * Inverte o card para mostrar a tradução e os detalhes.
 * @param {boolean} isCorrect Indica se o usuário acertou ou errou.
 */
function flipCard(isCorrect) {
    if (isCardFlipped) return;
    isCardFlipped = true;
    document.getElementById('flashcard-container').classList.add('is-flipped');

    document.body.classList.add(isCorrect ? 'correct-bg' : 'incorrect-bg');
    document.body.classList.remove(isCorrect ? 'incorrect-bg' : 'correct-bg');

    document.getElementById('quiz-options-container').classList.add('hidden');
    document.getElementById('quiz-typing-container').classList.add('hidden');
    document.getElementById('review-result-controls').classList.remove('hidden');
}

/**
 * Atualiza o nível de revisão do flashcard.
 * @param {boolean} isCorrect Se o usuário acertou o card.
 */
async function updateCardReviewStatus(isCorrect) {
    if (!currentCard || !flashcardsCollectionRef) return;

    let newLevel = currentCard.reviewLevel;
    if (isCorrect) {
        newLevel = Math.min(newLevel + 1, EBBINGHAUS_INTERVALS_DAYS.length - 1);
    } else {
        newLevel = Math.max(0, newLevel - 1);
    }

    const nextReviewDate = getNextReviewDate(newLevel);

    try {
        const cardRef = doc(flashcardsCollectionRef, currentCard.id);
        await updateDoc(cardRef, {
            reviewLevel: newLevel,
            nextReview: Timestamp.fromDate(nextReviewDate),
            lastReviewed: Timestamp.now(),
            totalReviews: (currentCard.totalReviews || 0) + 1,
            correctCount: (currentCard.correctCount || 0) + (isCorrect ? 1 : 0),
        });
        console.log(`Card ${currentCard.id} atualizado. Nível: ${newLevel}`);
    } catch (error) {
        console.error("Erro ao atualizar o status de revisão:", error);
    }
}

// #################################################################
// ################### LÓGICA DA BIBLIOTECA ########################
// #################################################################

/**
 * Renderiza a lista de todos os flashcards na view Biblioteca.
 */
function renderBiblioteca() {
    const tbody = document.getElementById('biblioteca-table-body');
    const message = document.getElementById('biblioteca-message');
    tbody.innerHTML = '';

    if (!isAuthReady || allFlashcards.length === 0) {
        message.textContent = isAuthReady ? 'Nenhum flashcard cadastrado ainda.' : 'Carregando dados...';
        message.classList.remove('hidden');
        return;
    }

    message.classList.add('hidden');

    const sortedCards = [...allFlashcards].sort((a, b) => a.palavra.localeCompare(b.palavra));

    sortedCards.forEach((card, index) => {
        const tr = document.createElement('tr');
        tr.classList.add('hover:bg-gray-50');

        const levelText = `Nível ${card.reviewLevel}`;
        let levelColor = 'text-gray-700';
        if (card.reviewLevel >= 5) levelColor = 'text-green-600 font-bold';
        else if (card.reviewLevel >= 2) levelColor = 'text-blue-600';
        else levelColor = 'text-red-600';

        const nextReviewDate = card.nextReview instanceof Date ? card.nextReview.toLocaleDateString() : 'N/A';

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${index + 1}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${card.idioma}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">${card.palavra}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${levelColor}">${levelText}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${nextReviewDate}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <button data-card-id="${card.id}" class="btn-delete-card text-red-500 hover:text-red-700">Excluir</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-delete-card').forEach(button => {
        button.onclick = (e) => {
             // Usando confirm provisoriamente, idealmente seria um modal customizado
            if (window.confirm("Tem certeza de que deseja excluir este flashcard?")) {
                deleteCard(e.target.dataset.cardId);
            }
        };
    });
}

/**
 * Exclui um flashcard do Firestore.
 * @param {string} cardId O ID do documento a ser excluído.
 */
async function deleteCard(cardId) {
    if (!flashcardsCollectionRef) return;
    try {
        const cardRef = doc(flashcardsCollectionRef, cardId);
        await deleteDoc(cardRef);
        console.log(`Card ${cardId} excluído com sucesso.`);
    } catch (error) {
        console.error("Erro ao excluir o card:", error);
    }
}


// #################################################################
// ########################## UTILIDADES ###########################
// #################################################################

/**
 * Embaralha um array usando o algoritmo Fisher-Yates.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}


// #################################################################
// ##################### EVENT LISTENERS ###########################
// #################################################################

// 1. LOGIN
document.getElementById('btn-login-google').addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        // onAuthStateChanged cuidará da navegação
    } catch (error) {
        const errorMessage = error.message.includes('popup-closed-by-user') ?
            'Login cancelado pelo usuário.' :
            `Erro ao fazer login: ${error.code}`;
        document.getElementById('login-message').textContent = errorMessage;
        document.getElementById('login-message').classList.remove('hidden');
        console.error("Erro de login:", error);
    }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Erro ao fazer logout:", error);
    }
});

// 2. HOME (NAVEGAÇÃO)
document.getElementById('btn-home-adicionar').addEventListener('click', () => showView('view-add-menu'));
document.getElementById('btn-home-revisar').addEventListener('click', () => showView('view-revisao'));
document.getElementById('btn-home-biblioteca').addEventListener('click', () => showView('view-biblioteca'));

// 3. ADICIONAR CARDS (SUB-MENU)
document.getElementById('btn-add-manual').addEventListener('click', () => showView('view-add-manual'));
document.getElementById('btn-add-automatico').addEventListener('click', () => showView('view-add-automatico'));
document.getElementById('btn-back-from-add-menu').addEventListener('click', () => showView('view-home'));

// 3a. ADICIONAR MANUAL
document.getElementById('btn-back-from-manual').addEventListener('click', () => showView('view-add-menu'));

document.getElementById('form-add-manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idioma = document.getElementById('manual-idioma').value.trim();
    const palavra = document.getElementById('manual-palavra').value.trim();
    const traducao = document.getElementById('manual-traducao').value.trim();
    const exemplosStr = document.getElementById('manual-exemplos').value.trim();

    const exemplos = exemplosStr.split(';').map(ex => ex.trim()).filter(ex => ex.length > 0);

    if (!idioma || !palavra || !traducao || exemplos.length === 0) {
        const messageEl = document.getElementById('manual-message');
        messageEl.textContent = 'Preencha todos os campos obrigatórios.';
        messageEl.classList.add('text-red-500');
        return;
    }

    const cardData = { idioma, palavra, traducao, exemplos };
    const success = await saveFlashcard(cardData);
    const messageEl = document.getElementById('manual-message');

    if (success) {
        messageEl.textContent = 'Flashcard salvo com sucesso!';
        messageEl.classList.add('text-green-500');
        messageEl.classList.remove('text-red-500');
        document.getElementById('form-add-manual').reset();
    } else {
        messageEl.textContent = 'Erro ao salvar o flashcard. Tente novamente.';
        messageEl.classList.add('text-red-500');
        messageEl.classList.remove('text-green-500');
    }
});

// 3b. ADICIONAR AUTOMÁTICO
document.getElementById('btn-back-from-automatico').addEventListener('click', () => showView('view-add-menu'));

document.getElementById('btn-processar-json').addEventListener('click', async () => {
    const jsonInput = document.getElementById('automatico-json-input').value.trim();
    const messageEl = document.getElementById('automatico-message');
    messageEl.textContent = 'Processando...';
    messageEl.classList.remove('text-red-500', 'text-green-500');

    if (!jsonInput) {
        messageEl.textContent = 'Cole o JSON antes de processar.';
        messageEl.classList.add('text-red-500');
        return;
    }

    try {
        const cardsArray = JSON.parse(jsonInput);
        if (!Array.isArray(cardsArray)) {
            throw new Error("O conteúdo deve ser um array JSON.");
        }

        let savedCount = 0;
        for (const card of cardsArray) {
            if (card.idioma && card.palavra && card.traducao && Array.isArray(card.exemplos) && card.exemplos.length > 0) {
                const cardData = {
                    idioma: card.idioma,
                    palavra: card.palavra,
                    traducao: card.traducao,
                    exemplos: card.exemplos,
                };
                const success = await saveFlashcard(cardData);
                if (success) savedCount++;
            } else {
                console.warn("Card JSON inválido ignorado:", card);
            }
        }

        document.getElementById('automatico-json-input').value = '';
        messageEl.textContent = `${savedCount} card(s) salvo(s) com sucesso! ${cardsArray.length - savedCount} card(s) ignorado(s) por serem inválidos.`;
        messageEl.classList.add('text-green-500');

    } catch (error) {
        messageEl.textContent = `Erro ao processar JSON: ${error.message}`;
        messageEl.classList.add('text-red-500');
        console.error("Erro ao processar JSON:", error);
    }
});

// 4. REVISÃO (QUIZ/TYPING)
document.getElementById('btn-back-from-revisao').addEventListener('click', () => showView('view-home'));

// Múltipla Escolha
document.querySelectorAll('.quiz-option-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        if (isCardFlipped || !currentCard) return;

        const selectedAnswer = e.target.textContent;
        const isCorrect = selectedAnswer === correctAnswer;

        document.querySelectorAll('.quiz-option-btn').forEach(btn => {
            btn.disabled = true;
            if (btn.textContent === correctAnswer) {
                btn.classList.add('bg-green-100', 'border-green-500');
                btn.classList.remove('bg-gray-50', 'border-gray-200');
            } else if (btn.textContent === selectedAnswer) {
                btn.classList.add('bg-red-100', 'border-red-500');
                btn.classList.remove('bg-gray-50', 'border-gray-200');
            }
        });

        flipCard(isCorrect);
        updateCardReviewStatus(isCorrect);
    });
});

// Digitação
document.getElementById('typing-submit-btn').addEventListener('click', () => {
    if (isCardFlipped || !currentCard) return;

    const typedAnswer = document.getElementById('typing-input').value.trim();
    // Verifica a correção ignorando capitalização para simplicidade na digitação
    const isCorrect = typedAnswer.toLowerCase() === correctAnswer.toLowerCase();
    const messageEl = document.getElementById('typing-message');

    if (!typedAnswer) {
        messageEl.textContent = "Digite algo para verificar.";
        messageEl.classList.add('text-red-500');
        return;
    }

    messageEl.classList.remove('text-red-500', 'text-green-600', 'text-red-600');
    messageEl.textContent = isCorrect ? "Correto!" : `Incorreto. A tradução correta é: "${correctAnswer}"`;
    messageEl.classList.add(isCorrect ? 'text-green-600' : 'text-red-600');

    flipCard(isCorrect);
    updateCardReviewStatus(isCorrect);
});

// Próximo Card (após flip)
document.getElementById('btn-next-card').addEventListener('click', () => {
    loadFlashcardForReview();
});


// 5. BIBLIOTECA
document.getElementById('btn-back-from-biblioteca').addEventListener('click', () => showView('view-home'));


// #################################################################
// ################## INICIALIZAÇÃO DA APLICAÇÃO ###################
// #################################################################

// Tenta autenticar ao carregar a página
authenticateUser();