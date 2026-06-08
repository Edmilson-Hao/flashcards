// ============================================================================
// 1. REGISTRO DO SERVICE WORKER (MODO 100% OFFLINE)
// ============================================================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(() => console.log("Modo 100% Offline Ativo com Sucesso!"))
        .catch((err) => console.log("Falha ao registrar Service Worker:", err));
}

// ============================================================================
// 2. ESTADO GLOBAL DO APLICATIVO
// ============================================================================
let appState = {
    cards: [],                // Lista unificada de cards (dados originais + progresso)
    currentCard: null,        // Card atualmente ativo na tela
    lastViewedCardHanzi: null,// Guarda o Hanzi do último card para evitar repetição imediata
    streak: 0,                // Ofensiva de dias seguidos estudando
    lastStudyDate: null,      // Última data de estudo ('AAAA-MM-DD')
    dailyGoalMinutes: 10,     // Meta de estudo em minutos
    timeStudiedToday: 0,      // Tempo estudado hoje (em segundos)
    lastActiveDate: null,     // Controle diário para resetar tempo
    wrongAnswersPool: []      // Pool para gerar distratores de múltipla escolha
};

let studyTimer = null;

// ============================================================================
// GERADOR DE FEEDBACK SONORO SINTÉTICO (WEB AUDIO API - 100% OFFLINE)
// ============================================================================
const SoundFeedback = {
    ctx: null,

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },

    playSuccess() {
        this.init();
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); 
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); 
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.25);
    },

    playError() {
        this.init();
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sawtooth'; 
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.linearRampToValueAtTime(100, now + 0.25);
        
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.3);
    }
};

// ============================================================================
// 3. INICIALIZAÇÃO DO APP E FUSÃO DE DADOS (COM TRATAMENTO DE ERROS ROBUSTO)
// ============================================================================
function saveToLocalStorage() {
    const progressToSave = {};
    appState.cards.forEach(card => {
        progressToSave[card.hanzi] = {
            level: card.level,
            nextReview: card.nextReview,
            easiness: card.easiness,
            repetitions: card.repetition || card.repetitions || 0
        };
    });
    
    localStorage.setItem('flashcards_progress', JSON.stringify(progressToSave));
    localStorage.setItem('flashcards_config', JSON.stringify({
        streak: appState.streak,
        lastStudyDate: appState.lastStudyDate,
        dailyGoalMinutes: appState.dailyGoalMinutes,
        timeStudiedToday: appState.timeStudiedToday,
        lastActiveDate: appState.lastActiveDate
    }));
}

async function initApp(newDataFile) {
    let dataArray = newDataFile;
    if (!dataArray && window.dados_palavras) dataArray = window.dados_palavras;
    
    if (!dataArray) {
        try {
            const response = await fetch('words.json');
            
            if (!response.ok) {
                throw new Error(`Erro de Rede: Não foi possível acessar o arquivo 'words.json' (Status: ${response.status} - ${response.statusText})`);
            }
            
            const textData = await response.text();
            try {
                dataArray = JSON.parse(textData);
            } catch (jsonError) {
                throw new Error(`JSON Corrompido: Existe um erro de sintaxe ou caractere inválido dentro do seu 'words.json'.<br><small style="color: #ef4444;">Detalhe técnico: ${jsonError.message}</small>`);
            }

        } catch(e) {
            const display = document.getElementById('main-display');
            const instructionText = document.getElementById('instruction-text');
            const inputZone = document.getElementById('input-zone');
            
            if (instructionText) instructionText.innerText = "FALHA CRÍTICA DE INICIALIZAÇÃO";
            if (display) {
                display.style.fontSize = "1.5rem";
                display.style.color = "#f43f5e";
                display.innerHTML = `⚠️ Falha ao Carregar Dados`;
            }
            if (inputZone) {
                inputZone.innerHTML = `
                    <div style="background: #1e293b; border: 2px solid #e11d48; padding: 20px; border-radius: 12px; color: #cbd5e1; font-family: sans-serif; text-align: left; line-height: 1.6; font-size: 0.95rem; width: 100%; box-sizing: border-box;">
                        <p style="margin-top: 0; font-weight: bold; color: #f43f5e;">O aplicativo não conseguiu iniciar porque:</p>
                        <p style="background: #0f172a; padding: 12px; border-radius: 6px; border-left: 4px solid #e11d48; font-family: monospace; font-size: 0.9rem; color: #fda4af; overflow-x: auto;">
                            ${e.message}
                        </p>
                        <ul style="margin-bottom: 0; padding-left: 20px; font-size: 0.85rem; color: #94a3b8;">
                            <li>Verifique se o arquivo <strong>words.json</strong> está na mesma pasta raiz.</li>
                            <li>Se editou o arquivo recentemente, verifique se esqueceu alguma vírgula ou aspas.</li>
                            <li>Certifique-se que está a rodar a aplicação através de um servidor local (Live Server).</li>
                        </ul>
                    </div>
                `;
            }
            return;
        }
    }

    if (!dataArray || dataArray.length === 0) {
        const display = document.getElementById('main-display');
        if (display) display.innerText = "Banco de dados vazio";
        return;
    }

    appState.wrongAnswersPool = dataArray.map(w => w.traducao);

    const localProgress = JSON.parse(localStorage.getItem('flashcards_progress')) || {};
    const localConfig = JSON.parse(localStorage.getItem('flashcards_config')) || {};
    
    appState.streak = localConfig.streak || 0;
    appState.lastStudyDate = localConfig.lastStudyDate || null;
    appState.dailyGoalMinutes = localConfig.dailyGoalMinutes || 10;
    
    const todayStr = new Date().toISOString().split('T')[0];
    if (localConfig.lastActiveDate !== todayStr) {
        appState.timeStudiedToday = 0;
        appState.lastActiveDate = todayStr;
    } else {
        appState.timeStudiedToday = localConfig.timeStudiedToday || 0;
    }

    appState.cards = dataArray.map(wordData => {
        const savedProgress = localProgress[wordData.hanzi]; 
        if (savedProgress) {
            return { 
                ...wordData, 
                ...savedProgress,
                repetition: savedProgress.repetitions || savedProgress.repetition || 0 
            };
        }
        return { 
            ...wordData, 
            level: 0, 
            nextReview: Date.now(), 
            easiness: 2.5, 
            repetition: 0 
        };
    });

    injectOptionsDashboard();
    checkStreakWindow();
    saveToLocalStorage();
    startStudyTimer();
    updateTimerUI();
    updateStatisticsUI();
    nextCard(); 
    initKeyboardShortcuts();
}

function injectOptionsDashboard() {
    const cardPanel = document.getElementById('card-panel') || document.querySelector('.card') || document.getElementById('main-display')?.parentElement;
    
    if (cardPanel && !document.getElementById('study-options-dashboard')) {
        const dashboard = document.createElement('div');
        dashboard.id = 'study-options-dashboard';
        dashboard.style.cssText = "background: #1e293b; padding: 14px; border-radius: 12px; margin-bottom: 16px; border: 1px solid #334155; color: #f8fafc; font-family: sans-serif;";
        
        dashboard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span>🔥 Ofensiva:</span> 
                    <strong style="color: #f97316;"><span id="streak-count">0</span> dias</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <label for="goal-select" style="font-size: 0.85rem; color: #94a3b8;">Meta Diária:</label>
                    <select id="goal-select" onchange="changeDailyGoal(this.value)" style="background: #0f172a; color: #f8fafc; border: 1px solid #475569; padding: 4px 8px; border-radius: 6px; cursor: pointer; outline: none; font-size: 0.85rem;">
                        <option value="5">5 min</option>
                        <option value="10">10 min</option>
                        <option value="15">15 min</option>
                        <option value="20">20 min</option>
                    </select>
                </div>
            </div>
            <div style="margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">
                    <span>Tempo hoje: <strong id="time-today" style="color: #3b82f6;">00:00</strong></span>
                    <span id="goal-status">0% da meta</span>
                </div>
                <div style="width: 100%; background: #334155; height: 6px; border-radius: 3px; overflow: hidden;">
                    <div id="goal-bar" style="width: 0%; height: 100%; background: #3b82f6; transition: width 0.3s, background-color 0.3s;"></div>
                </div>
            </div>
        `;
        cardPanel.insertBefore(dashboard, cardPanel.firstChild);
    }
}

// ============================================================================
// 4. FILTRAGEM, PRIORIDADE E ALEATORIEDADE
// ============================================================================
function nextCard() {
    const totalCards = appState.cards.length;
    if (totalCards === 0) return;

    const masteredCards = appState.cards.filter(c => c.level > 3).length; 
    if (masteredCards === totalCards) {
        showLockScreen("🎉 Incrível! Você atingiu 100% de domínio em todos os cards disponíveis!");
        return;
    }

    const now = Date.now();
    let reviewQueue = appState.cards.filter(c => c.nextReview <= now && c.level <= 3);
    
    if (reviewQueue.length === 0) {
        showLockScreen("☕ Todas as revisões agendadas foram concluídas por hoje!");
        return;
    }

    let lowestLevelAvailable = Math.min(...reviewQueue.map(c => c.level));
    let targetLevelPool = reviewQueue.filter(c => c.level === lowestLevelAvailable);

    let finalSelectionPool = targetLevelPool;
    if (targetLevelPool.length > 1 && appState.lastViewedCardHanzi) {
        finalSelectionPool = targetLevelPool.filter(c => c.hanzi !== appState.lastViewedCardHanzi);
    } 
    else if (targetLevelPool.length === 1 && appState.lastViewedCardHanzi && targetLevelPool[0].hanzi === appState.lastViewedCardHanzi) {
        let fallbackPool = reviewQueue.filter(c => c.hanzi !== appState.lastViewedCardHanzi);
        if (fallbackPool.length > 0) {
            finalSelectionPool = fallbackPool;
        }
    }

    const randomIndex = Math.floor(Math.random() * finalSelectionPool.length);
    appState.currentCard = finalSelectionPool[randomIndex];
    appState.lastViewedCardHanzi = appState.currentCard.hanzi;

    renderFlashcard(appState.currentCard);
}

// ============================================================================
// 5. PROCESSAMENTO ALGORITMO SM-2 RECALIBRADO
// ============================================================================
function processSM2Response(isCorrect) {
    if (!appState.currentCard) return;

    let card = appState.currentCard;
    const quality = isCorrect ? 5 : 2;

    if (isCorrect) {
        if (!card.repetition) card.repetition = 0;
        
        if (card.repetition === 0) {
            card.interval = 1; 
        } else if (card.repetition === 1) {
            card.interval = 3; 
        } else {
            card.interval = Math.ceil(card.interval * card.easiness);
        }
        card.repetition += 1;
        
        if (card.level < 2) {
            card.level += 1;
        }
    } else {
        card.repetition = 0;
        card.interval = 1; 
        card.level = 0;
    }

    let scoreMod = (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    card.easiness = (card.easiness || 2.5) + scoreMod;

    if (card.easiness < 1.3) card.easiness = 1.3;
    if (card.easiness > 2.5) card.easiness = 2.5;

    // Calcula timestamp do próximo dia de revisão baseado no intervalo
    card.nextReview = Date.now() + (card.interval * 24 * 60 * 60 * 1000);

    saveToLocalStorage();
    updateStatisticsUI();
    nextCard();
}

// ============================================================================
// 6. ATALHOS DE TECLADO
// ============================================================================
function initKeyboardShortcuts() {
    window.removeEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keydown', handleGlobalKeyDown);
}

function handleGlobalKeyDown(e) {
    if (!appState.currentCard || appState.currentCard.level !== 0) return;

    if (['1', '2', '3', '4'].includes(e.key)) {
        const index = parseInt(e.key) - 1; 
        const buttons = document.querySelectorAll('#input-zone button');
        if (buttons && buttons[index]) {
            buttons[index].click();
        }
    }
}

// ============================================================================
// 7. RENDERIZAÇÃO DOS FLASHCARDS
// ============================================================================
function renderFlashcard(card) {
    const mainDisplay = document.getElementById('main-display');
    const subDisplay = document.getElementById('sub-display');
    const cardLevel = document.getElementById('card-level');
    const instructionText = document.getElementById('instruction-text');
    const inputZone = document.getElementById('input-zone');
    const feedbackText = document.getElementById('feedback-text');

    if (feedbackText) feedbackText.innerText = "";
    if (subDisplay) subDisplay.innerText = "";
    
    if (cardLevel) {
        cardLevel.innerText = `Nível ${card.level + 1}`;
    }

    // NÍVEL 1: RECONHECIMENTO VISUAL (MÚLTIPLA ESCOLHA)
    if (card.level === 0) {
        if (instructionText) instructionText.innerText = "RECONHECIMENTO VISUAL: SELECIONE A TRADUÇÃO CORRETA (OU USE AS TECLAS 1, 2, 3, 4):";
        if (mainDisplay) mainDisplay.innerText = card.hanzi;

        const correctAns = card.traducao;
        const optionsSet = new Set([correctAns]);
        const pool = appState.wrongAnswersPool || [];
        const poolLength = pool.length;
        const targetSize = Math.min(4, poolLength);

        let attempts = 0;
        while (optionsSet.size < targetSize && attempts < 50) {
            attempts++;
            const randIdx = Math.floor(Math.random() * poolLength);
            const picked = pool[randIdx];
            if (picked && picked !== correctAns) {
                optionsSet.add(picked);
            }
        }

        while (optionsSet.size < Math.min(4, poolLength + 1) && optionsSet.size < 4) {
            optionsSet.add("---");
        }

        let options = Array.from(optionsSet);
        options.sort(() => Math.random() - 0.5);

        if (inputZone) {
            inputZone.innerHTML = `
                <div class="options-grid">
                    ${options.map((opt, index) => `
                        <button onclick="checkLevel1Answer('${opt.replace(/'/g, "\\'")}')" class="option-btn">
                            <span class="shortcut-badge">${index + 1}</span>
                            <span class="option-text">${opt}</span>
                        </button>
                    `).join('')}
                </div>
            `;
        }
    } 
    // NÍVEL 2: FIXAÇÃO FONÉTICA (INPUT DEL PINYIN)
    else if (card.level === 1) {
        if (instructionText) instructionText.innerText = "FIXAÇÃO FONÉTICA: DIGITE O PINYIN CORRESPONDENTE COM O TOM (Ex: lao3shi1):";
        if (mainDisplay) mainDisplay.innerText = card.hanzi;

        if (inputZone) {
            inputZone.innerHTML = `
                <div class="input-wrapper">
                    <input type="text" id="pinyin-input" class="text-input-field pinyin-field" placeholder="Ex: xue2sheng5" autocomplete="off" />
                    <button onclick="checkLevel2Answer()" class="submit-btn btn-pinyin">Verificar Resposta</button>
                    <div class="tone-guide-box">
                        <span class="tone-guide-title">Guia de Tons de Referência:</span>
                        <img src="tons.png" class="tone-guide-img" alt="Tons Mandarim" />
                    </div>
                </div>
            `;

            const inputEl = document.getElementById('pinyin-input');
            if (inputEl) {
                inputEl.focus();
                inputEl.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') checkLevel2Answer();
                });
            }
        }
    }
    // NÍVEL 3: MANDARIM VISUAL (INPUT DEL HANZI)
    else if (card.level === 2) {
        if (instructionText) instructionText.innerText = "MANDARIM VISUAL: COM O TECLADO CHINÊS ATIVADO, DIGITE OS CARACTERES:";
        if (mainDisplay) mainDisplay.innerText = card.traducao;
        if (subDisplay) subDisplay.innerText = `Leitura de apoio: ${card.pinyin}`;

        if (inputZone) {
            inputZone.innerHTML = `
                <div class="input-wrapper">
                    <input type="text" id="hanzi-input" class="text-input-field hanzi-field" placeholder="Digite nihao -> converta para 你好" autocomplete="off" />
                    <button onclick="checkLevel3Answer()" class="submit-btn btn-hanzi">Validar Caracteres</button>
                </div>
            `;

            const inputEl = document.getElementById('hanzi-input');
            if (inputEl) {
                inputEl.focus();
                inputEl.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') checkLevel3Answer();
                });
            }
        }
    }
}

// ============================================================================
// 8. VERIFICAÇÕES DE RESPOSTAS E FEEDBACKS
// ============================================================================
function checkLevel1Answer(selectedOption) {
    const feedbackText = document.getElementById('feedback-text');
    const isCorrect = selectedOption === appState.currentCard.traducao;

    if (isCorrect) {
        SoundFeedback.playSuccess();
        triggerStreakUpdate();
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = `Correto! Palavra promovida para o Nível ${appState.currentCard.level + 2} (Fixação Fonética).`;
        }
        setTimeout(() => processSM2Response(true), 1200);
    } else {
        SoundFeedback.playError();
        if (feedbackText) {
            feedbackText.style.color = "#ef4444";
            feedbackText.innerText = `Incorreto! Retornada ao Nível 1. Resposta: ${appState.currentCard.traducao}`;
        }
        setTimeout(() => processSM2Response(false), 2000);
    }
}

function checkLevel2Answer() {
    const inputEl = document.getElementById('pinyin-input');
    const feedbackText = document.getElementById('feedback-text');
    if (!inputEl) return;

    const userInput = inputEl.value.trim().toLowerCase().replace(/\s+/g, '');
    const correctTargetNumeric = convertPinyinToNumbers(appState.currentCard.pinyin);
    
    if (userInput === correctTargetNumeric) {
        SoundFeedback.playSuccess();
        triggerStreakUpdate();
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = `Correto! Palavra promovida para o Nível ${appState.currentCard.level + 2} (Mandarim Visual).`;
        }
        setTimeout(() => processSM2Response(true), 1200);
    } else {
        SoundFeedback.playError();
        if (feedbackText) {
            feedbackText.style.color = "#ef4444";
            feedbackText.innerText = `Incorreto! Retornada ao Nível 1. Esperado: ${correctTargetNumeric}`;
        }
        setTimeout(() => processSM2Response(false), 2500);
    }
}

function checkLevel3Answer() {
    const inputEl = document.getElementById('hanzi-input');
    const feedbackText = document.getElementById('feedback-text');
    if (!inputEl) return;

    const userInput = inputEl.value.trim().replace(/\s+/g, '');
    const correctTargetHanzi = appState.currentCard.hanzi.trim().replace(/\s+/g, '');

    if (userInput === correctTargetHanzi) {
        SoundFeedback.playSuccess();
        triggerStreakUpdate();
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = "Perfeito! Palavra elevada ao Nível 4 (Domínio Concluído).";
        }
        setTimeout(() => processSM2Response(true), 1200);
    } else {
        SoundFeedback.playError();
        if (feedbackText) {
            feedbackText.style.color = "#ef4444";
            feedbackText.innerText = `Divergente! Retornada ao Nível 1. Esperado: ${correctTargetHanzi}`;
        }
        setTimeout(() => processSM2Response(false), 2500);
    }
}

function convertPinyinToNumbers(pinyinText) {
    const toneMap = {
        'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
        'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
        'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
        'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
        'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
        'ü': 'v',  'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4'
    };

    let wordsArray = pinyinText.toLowerCase().trim().split(/\s+/);
    let processedWords = wordsArray.map(word => {
        let tone = '5'; 
        let cleanWord = '';
        for (let char of word) {
            if (toneMap[char]) {
                tone = toneMap[char][1];
                cleanWord += toneMap[char][0];
            } else {
                cleanWord += char;
            }
        }
        return cleanWord + tone;
    });
    return processedWords.join('');
}

function showLockScreen(message) {
    const mainDisplay = document.getElementById('main-display');
    const instructionText = document.getElementById('instruction-text');
    const inputZone = document.getElementById('input-zone');
    const subDisplay = document.getElementById('sub-display');

    if (instructionText) instructionText.innerText = "SISTEMA SEGURO";
    if (subDisplay) subDisplay.innerText = "";
    if (mainDisplay) mainDisplay.innerText = "🔒";
    if (inputZone) {
        inputZone.innerHTML = `
            <div style="text-align: center; color: #94a3b8; font-size: 0.95rem; line-height: 1.5; padding: 10px;">
                ${message}
            </div>
        `;
    }
}

// ============================================================================
// 9. TIMER E MONITOR DE OFENSIVAS
// ============================================================================
function startStudyTimer() {
    if (studyTimer) {
        clearInterval(studyTimer);
        studyTimer = null;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (appState.lastActiveDate !== todayStr) {
        appState.timeStudiedToday = 0;
        appState.lastActiveDate = todayStr;
    }

    studyTimer = setInterval(() => {
        const currentCheckDate = new Date().toISOString().split('T')[0];
        if (appState.lastActiveDate !== currentCheckDate) {
            appState.timeStudiedToday = 0;
            appState.lastActiveDate = currentCheckDate;
        }

        appState.timeStudiedToday++;
        
        // Sincroniza o salvamento a cada 5 segundos para não sobrecarregar o disco
        if (appState.timeStudiedToday % 5 === 0) {
            saveToLocalStorage();
        }

        updateTimerUI();
    }, 1000);
}

function triggerStreakUpdate() {
    const todayStr = new Date().toISOString().split('T')[0];
    if (appState.lastStudyDate !== todayStr) {
        const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        if (appState.lastStudyDate === yesterdayStr || appState.lastStudyDate === null) {
            appState.streak++;
        } else {
            appState.streak = 1;
        }
        
        appState.lastStudyDate = todayStr;
        saveToLocalStorage();
        updateTimerUI();
    }
}

function checkStreakWindow() {
    if (!appState.lastStudyDate) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    if (appState.lastStudyDate !== todayStr && appState.lastStudyDate !== yesterdayStr) {
        appState.streak = 0;
        saveToLocalStorage();
    }
}

function changeDailyGoal(minutes) {
    appState.dailyGoalMinutes = parseInt(minutes);
    saveToLocalStorage();
    updateTimerUI();
}

function updateTimerUI() {
    const minutesStudied = Math.floor(appState.timeStudiedToday / 60);
    const secondsRemaining = appState.timeStudiedToday % 60;
    
    const timeToday = document.getElementById('time-today');
    const streakCount = document.getElementById('streak-count');
    const goalBar = document.getElementById('goal-bar');
    const goalStatus = document.getElementById('goal-status');
    const goalSelect = document.getElementById('goal-select');

    if (timeToday) timeToday.innerText = `${String(minutesStudied).padStart(2, '0')}:${String(secondsRemaining).padStart(2, '0')}`;
    if (streakCount) streakCount.innerText = appState.streak;
    if (goalSelect) goalSelect.value = appState.dailyGoalMinutes;

    const targetSeconds = appState.dailyGoalMinutes * 60;
    const percentage = Math.min((appState.timeStudiedToday / targetSeconds) * 100, 100);
    
    if (goalBar) {
        goalBar.style.width = `${percentage}%`;
        goalBar.style.backgroundColor = percentage >= 100 ? "#10b981" : "#3b82f6";
    }
    if (goalStatus) goalStatus.innerText = `${Math.floor(percentage)}% da meta`;
}

function updateStatisticsUI() {
    const totalCards = appState.cards.length;
    const statTotal = document.getElementById('stat-total');
    if (statTotal) statTotal.innerText = totalCards;

    if (totalCards === 0) return;

    const lvl1 = appState.cards.filter(c => c.level === 0).length;
    const lvl2 = appState.cards.filter(c => c.level === 1).length;
    const lvl3 = appState.cards.filter(c => c.level === 2).length; 
    const lvlM = appState.cards.filter(c => c.level > 2).length; 

    const now = Date.now();
    const dueCount = appState.cards.filter(c => c.nextReview <= now && c.level <= 2).length;

    const statDue = document.getElementById('stat-due');
    if (statDue) statDue.innerText = dueCount;

    const masteryPercentage = Math.round((lvlM / totalCards) * 100);
    
    const progressPercent = document.getElementById('progress-percent');
    if (progressPercent) progressPercent.innerText = `${masteryPercentage}%`;

    const mainProgressBar = document.getElementById('main-progress-bar');
    if (mainProgressBar) mainProgressBar.style.width = `${masteryPercentage}%`;

    const countL1 = document.getElementById('count-l1');
    const countL2 = document.getElementById('count-l2');
    const countL3 = document.getElementById('count-l3');

    if (countL1) countL1.innerText = lvl1;
    if (countL2) countL2.innerText = lvl2;
    if (countL3) countL3.innerText = lvl3;

    const barL1 = document.getElementById('bar-l1');
    const barL2 = document.getElementById('bar-l2');
    const barL3 = document.getElementById('bar-l3');

    if (barL1) barL1.style.width = `${(lvl1 / totalCards) * 100}%`;
    if (barL2) barL2.style.width = `${(lvl2 / totalCards) * 100}%`;
    if (barL3) barL3.style.width = `${(lvl3 / totalCards) * 100}%`;
}

function showNotification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification(title, { body });
            }
        });
    }
}

// Inicialização segura quando a página carrega completamente
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});