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
// 3. INICIALIZAÇÃO DO APP E FUSÃO DE DADOS
// ============================================================================
async function initApp(newDataFile) {
    let dataArray = newDataFile;
    if (!dataArray && window.dados_palavras) dataArray = window.dados_palavras;
    if (!dataArray) {
        try {
            const response = await fetch('words.json');
            dataArray = await response.json();
        } catch(e) {
            dataArray = [];
        }
    }

    if (!dataArray || dataArray.length === 0) {
        const display = document.getElementById('main-display');
        if (display) display.innerText = "Sem dados";
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
            return { ...wordData, ...savedProgress };
        }
        return { 
            ...wordData, 
            level: 0, 
            nextReview: Date.now(), 
            easiness: 2.5, 
            repetitions: 0 
        };
    });

    injectOptionsDashboard();
    checkStreakWindow();
    saveToLocalStorage();
    startStudyTimer();
    updateTimerUI();
    updateStatisticsUI();
    nextCard(); 
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

function saveToLocalStorage() {
    const progressToSave = {};
    appState.cards.forEach(card => {
        progressToSave[card.hanzi] = {
            level: card.level,
            nextReview: card.nextReview,
            easiness: card.easiness,
            repetitions: card.repetitions
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

// ============================================================================
// 4. MODIFICADO: ALTERAÇÃO 1, 2 E 3 - FILTRAGEM, PRIORIDADE E ALEATORIEDADE
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
    // Filtra apenas os que precisam de revisão
    let reviewQueue = appState.cards.filter(c => c.nextReview <= now && c.level <= 3);
    
    if (reviewQueue.length === 0) {
        showLockScreen("☕ Todas as revisões agendadas foram concluídas por hoje!");
        return;
    }

    // 1. Encontra qual o menor nível disponível na fila atual para priorização estrita (Alteração 1)
    let lowestLevelAvailable = Math.min(...reviewQueue.map(c => c.level));
    
    // 2. Isola apenas os cards que pertencem a esse menor nível
    let targetLevelPool = reviewQueue.filter(c => c.level === lowestLevelAvailable);

    // 3. Aplica a Regra de Não Repetição Imediata se houver alternativas (Alteração 3)
    let finalSelectionPool = targetLevelPool;
    if (targetLevelPool.length > 1 && appState.lastViewedCardHanzi) {
        finalSelectionPool = targetLevelPool.filter(c => c.hanzi !== appState.lastViewedCardHanzi);
    } 
    // Fallback: Se só sobrou a mesma palavra no nível mais baixo, tenta buscar uma palavra de nível subsequente para quebrar o ritmo
    else if (targetLevelPool.length === 1 && appState.lastViewedCardHanzi && targetLevelPool[0].hanzi === appState.lastViewedCardHanzi) {
        let fallbackPool = reviewQueue.filter(c => c.hanzi !== appState.lastViewedCardHanzi);
        if (fallbackPool.length > 0) {
            finalSelectionPool = fallbackPool;
        }
    }

    // 4. Seleciona um card aleatório de dentro do pool filtrado (Alteração 2)
    const randomIndex = Math.floor(Math.random() * finalSelectionPool.length);
    appState.currentCard = finalSelectionPool[randomIndex];
    
    // Atualiza o rastreador de histórico
    appState.lastViewedCardHanzi = appState.currentCard.hanzi;

    renderFlashcard(appState.currentCard);
}

function processSM2Response(isCorrect) {
    let card = appState.currentCard;
    if (!card) return;

    if (isCorrect) {
        if (card.repetitions === 0) {
            card.nextReview = Date.now() + 86400000; 
        } else if (card.repetitions === 1) {
            card.nextReview = Date.now() + (6 * 86400000); 
        } else {
            const days = Math.round((card.repetitions - 1) * card.easiness);
            card.nextReview = Date.now() + (days * 86400000);
        }
        card.repetitions++;
        card.level++; 
        card.easiness = card.easiness + (0.1 - 0 * (0.08 + 0 * 0.02));
    } else {
        card.repetitions = 0;
        // Mantém elegível para revisão imediata nesta sessão, mas a lógica do nextCard() impedirá repetição consecutiva
        card.nextReview = Date.now(); 
        card.level = 0;
        card.easiness = card.easiness + (0.1 - 4 * (0.08 + 4 * 0.02));
    }

    if (card.easiness < 1.3) card.easiness = 1.3;

    saveToLocalStorage();
    updateStatisticsUI();
    nextCard();
}

// ============================================================================
// 5. RENDERIZAÇÃO
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

    if (card.level === 0) {
        if (instructionText) instructionText.innerText = "RECONHECIMENTO VISUAL: SELECIONE A TRADUÇÃO CORRETA:";
        if (mainDisplay) mainDisplay.innerText = card.hanzi;

        let options = [card.traducao];
        let pool = appState.wrongAnswersPool.filter(t => t !== card.traducao);
        
        while (options.length < Math.min(4, appState.wrongAnswersPool.length)) {
            let randIdx = Math.floor(Math.random() * pool.length);
            let picked = pool.splice(randIdx, 1)[0];
            if (picked && !options.includes(picked)) options.push(picked);
        }
        options.sort(() => Math.random() - 0.5);

        if (inputZone) {
            inputZone.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%;">
                    ${options.map(opt => `
                        <button onclick="checkLevel1Answer('${opt.replace(/'/g, "\\'")}')" class="action-btn" style="background: #334155; padding: 14px; border-radius: 8px; color: white; border: none; font-weight: 500; cursor: pointer; transition: background 0.2s;">${opt}</button>
                    `).join('')}
                </div>
            `;
        }
    } 
    else if (card.level === 1) {
        if (instructionText) instructionText.innerText = "FIXAÇÃO FONÉTICA: DIGITE O PINYIN CORRESPONDENTE COM O TOM (Ex: lao3shi1):";
        if (mainDisplay) mainDisplay.innerText = card.hanzi;

        if (inputZone) {
            inputZone.innerHTML = `
                <div style="width: 100%;">
                    <input type="text" id="pinyin-input" placeholder="Ex: xue2sheng5" autocomplete="off" style="width: 100%; padding: 16px; background: #0f172a; border: 2px solid #334155; border-radius: 10px; color: #fff; font-size: 1.3rem; text-align: center; box-sizing: border-box; margin-bottom: 16px;" />
                    <button onclick="checkLevel2Answer()" class="action-btn" style="width: 100%; background: #0284c7; padding: 14px; border-radius: 8px; color: white; border: none; font-weight: bold; cursor: pointer;">Verificar Resposta</button>
                    
                    <div style="margin-top: 20px; text-align: center;">
                        <span style="font-size: 11px; color: #94a3b8; display: block; margin-bottom: 6px;">Guia de Tons de Referência:</span>
                        <img src="tons.png" alt="Tons Mandarim" style="max-width: 100%; max-height: 140px; border-radius: 8px; border: 1px solid #334155; padding: 4px; background: #ffffff;" />
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
    else if (card.level === 2) {
        if (instructionText) instructionText.innerText = "MANDARIM VISUAL: COM O TECLADO CHINÊS ATIVADO, DIGITE OS CARACTERES:";
        if (mainDisplay) mainDisplay.innerText = card.traducao;
        if (subDisplay) subDisplay.innerText = `Leitura de apoio: ${card.pinyin}`;

        if (inputZone) {
            inputZone.innerHTML = `
                <div style="width: 100%;">
                    <input type="text" id="hanzi-input" placeholder="Digite nihao -> converta para 你好" autocomplete="off" style="width: 100%; padding: 16px; background: #0f172a; border: 2px solid #334155; border-radius: 10px; color: #fff; font-size: 1.5rem; text-align: center; box-sizing: border-box; margin-bottom: 16px;" />
                    <button onclick="checkLevel3Answer()" class="action-btn" style="width: 100%; background: #10b981; padding: 14px; border-radius: 8px; color: white; border: none; font-weight: bold; cursor: pointer;">Validar Caracteres</button>
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
// TRIGGERS DE VALIDAÇÃO
// ============================================================================
function checkLevel1Answer(selectedOption) {
    const feedbackText = document.getElementById('feedback-text');
    const isCorrect = selectedOption === appState.currentCard.traducao;

    if (isCorrect) {
        SoundFeedback.playSuccess();
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = "Correto! Palavra promovida para o Nível 2.";
        }
        setTimeout(() => processSM2Response(true), 1000);
    } else {
        SoundFeedback.playError();
        if (feedbackText) {
            feedbackText.style.color = "#ef4444";
            feedbackText.innerText = `Incorreto! Mantida no Nível 1. Resposta: ${appState.currentCard.traducao}`;
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
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = "Correto! Elevada ao Nível 3.";
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
        if (feedbackText) {
            feedbackText.style.color = "#10b981";
            feedbackText.innerText = "Perfeito! Palavra de nível máximo (Domínio).";
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
// 6. TIMER E MONITOR DE OFENSIVAS
// ============================================================================
function startStudyTimer() {
    if (studyTimer) clearInterval(studyTimer);
    
    studyTimer = setInterval(() => {
        appState.timeStudiedToday++;
        saveToLocalStorage();
        updateTimerUI();
        
        const targetSeconds = appState.dailyGoalMinutes * 60;
        if (appState.timeStudiedToday === targetSeconds) {
            triggerStreakUpdate();
            showNotification("Meta Diária Batida! 🔥", `Excelente! Meta concluída.`);
        }
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

    const lvl1 = appState.cards.filter(c => c.level === 1).length;
    const lvl2 = appState.cards.filter(c => c.level === 2).length;
    const lvl3 = appState.cards.filter(c => c.level === 3).length; 
    const lvlM = appState.cards.filter(c => c.level > 3).length; 

    const now = Date.now();
    const dueCount = appState.cards.filter(c => c.nextReview <= now && c.level <= 3).length;

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

window.addEventListener('DOMContentLoaded', () => {
    initApp();
});