
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ViewMode, SessionMode, AvatarGender, User } from './types';
import { searchTechnologies } from './services/geminiService';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [sessionMode, setSessionMode] = useState<SessionMode>('interview');
  const [avatarGender, setAvatarGender] = useState<AvatarGender>('male');
  const [languagePreference, setLanguagePreference] = useState<'english' | 'hinglish'>('hinglish');
  const [isLive, setIsLive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Persistence states
  const [conversationHistory, setConversationHistory] = useState<string[]>([]);
  const [masteryStage, setMasteryStage] = useState(1);
  const [lastActiveTime, setLastActiveTime] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const sessionRef = useRef<any>(null);
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // Persistence logic
  useEffect(() => {
    const savedTechs = localStorage.getItem('fp_selected_techs');
    const savedHistory = localStorage.getItem('fp_conv_history');
    const savedStage = localStorage.getItem('fp_mastery_stage');
    const savedLang = localStorage.getItem('fp_lang');
    const savedTime = localStorage.getItem('fp_last_active');

    if (savedTechs) setSelectedTechs(JSON.parse(savedTechs));
    if (savedHistory) setConversationHistory(JSON.parse(savedHistory));
    if (savedStage) setMasteryStage(parseInt(savedStage, 10));
    if (savedLang) setLanguagePreference(savedLang as 'english' | 'hinglish');
    if (savedTime) setLastActiveTime(savedTime);
  }, []);

  useEffect(() => {
    localStorage.setItem('fp_selected_techs', JSON.stringify(selectedTechs));
    localStorage.setItem('fp_conv_history', JSON.stringify(conversationHistory));
    localStorage.setItem('fp_mastery_stage', masteryStage.toString());
    localStorage.setItem('fp_lang', languagePreference);
    if (isLive) {
      const now = new Date().toLocaleTimeString();
      localStorage.setItem('fp_last_active', now);
      setLastActiveTime(now);
    }
  }, [selectedTechs, conversationHistory, masteryStage, languagePreference, isLive]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.length >= 2) {
        setIsSearching(true);
        const results = await searchTechnologies(searchTerm);
        setSuggestions(results.filter(t => !selectedTechs.includes(t)));
        setIsSearching(false);
      } else {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, selectedTechs]);

  const toggleTech = (tech: string) => {
    if (selectedTechs.includes(tech)) {
      setSelectedTechs(selectedTechs.filter(t => t !== tech));
    } else {
      setSelectedTechs([...selectedTechs, tech]);
      setSearchTerm('');
      setSuggestions([]);
    }
  };

  const clearSessionData = () => {
    setConversationHistory([]);
    setMasteryStage(1);
    setLastActiveTime(null);
    localStorage.removeItem('fp_conv_history');
    localStorage.removeItem('fp_mastery_stage');
    localStorage.removeItem('fp_last_active');
  };

  const startLiveSession = async (isResuming = false) => {
    if (selectedTechs.length === 0) return;
    
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputContextRef.current) inputContextRef.current.close();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    setIsLive(true);
    
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = outputCtx;
    inputContextRef.current = inputCtx;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
            sessionPromise.then(s => {
              if (s) s.sendRealtimeInput({ 
                media: { data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))), mimeType: 'audio/pcm;rate=16000' }
              });
            });
          };
          source.connect(processor);
          processor.connect(inputCtx.destination);
          
          const techList = selectedTechs.join(', ');
          const contextPrompt = isResuming && conversationHistory.length > 0
            ? `Resuming session. Previously we discussed: ${conversationHistory.slice(-4).join(' | ')}. We are at stage ${masteryStage}. Do not repeat the same questions.`
            : `Initial connection. Target stack: ${techList}.`;

          const langInstruction = languagePreference === 'hinglish' 
            ? "Speak in Hinglish (a mix of Hindi and English). Use Hindi for explanations and support, but keep technical terms like 'Architecture' or 'Deployment' in English."
            : "Speak strictly in professional English.";

          const initialMessage = `${contextPrompt} ${langInstruction} Let's ${isResuming ? 'continue' : 'begin'} the session.`;
          sessionPromise.then(s => s.sendRealtimeInput({ text: initialMessage }));
        },
        onmessage: async (msg: LiveServerMessage) => {
          if (msg.serverContent?.outputTranscription) {
            currentOutputTranscription.current += msg.serverContent.outputTranscription.text;
          } else if (msg.serverContent?.inputTranscription) {
            currentInputTranscription.current += msg.serverContent.inputTranscription.text;
          }

          if (msg.serverContent?.turnComplete) {
            const input = currentInputTranscription.current;
            const output = currentOutputTranscription.current;
            if (input || output) {
              setConversationHistory(prev => [...prev, `User: ${input}`, `AI: ${output}`].slice(-20));
              // Detect stage clearing from text if possible
              if (output.toLowerCase().includes("stage clear") || output.toLowerCase().includes("stage complete")) {
                setMasteryStage(s => Math.min(s + 1, 4));
              }
            }
            currentInputTranscription.current = '';
            currentOutputTranscription.current = '';
          }

          if (msg.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
            sourcesRef.current.clear();
            nextStartTimeRef.current = outputCtx.currentTime;
            return;
          }

          const base64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (base64) {
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const dataInt16 = new Int16Array(bytes.buffer);
            const buffer = outputCtx.createBuffer(1, dataInt16.length, 24000);
            const channelData = buffer.getChannelData(0);
            for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
            const source = outputCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(outputCtx.destination);
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            sourcesRef.current.add(source);
            source.onended = () => sourcesRef.current.delete(source);
          }
        },
        onclose: () => setIsLive(false),
        onerror: () => setIsLive(false)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: avatarGender === 'male' ? 'Zephyr' : 'Kore' } }
        },
        systemInstruction: `
          You are FuturePrep AI. TARGET STACK: ${selectedTechs.join(', ')}. 
          MODE: ${sessionMode.toUpperCase()}.
          CURRENT MASTERY STAGE: ${masteryStage}.
          LANGUAGE PREFERENCE: ${languagePreference === 'hinglish' ? 'HINGLISH (Hindi context + English technical terms)' : 'STRICT ENGLISH'}.
          
          PERSISTENCE PROTOCOL:
          - If the user returns, acknowledge where we left off (e.g., "Pichli baar humne Load Balancing par baat khatam ki thi...").
          - Always keep the conversation flowing.
          
          LANGUAGE RULES (if Hinglish):
          - Use Hindi for comforting, explaining, and conversational filler (e.g., "Aapka logic sahi hai," "Chaliye aage badhte hain").
          - Use English for ALL technical concepts (e.g., "Memory Leak," "Concurrency Control," "Kubernetes Pods").
          
          MASTERY LADDER:
          Stage 1: Basic concepts.
          Stage 2: Real-world logic.
          Stage 3: Design & Scale.
          Stage 4: Edge cases & Debugging.
          
          When the user demonstrates mastery of the current stage, explicitly say "Stage Clear" and introduce the next level.
        `
      }
    });
    sessionRef.current = await sessionPromise;
  };

  const stopSession = () => {
    if (sessionRef.current) try { sessionRef.current.close(); } catch(e) {}
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputContextRef.current) inputContextRef.current.close();
    setIsLive(false);
    setView('feedback');
  };

  const RocketBrainLogo = () => (
    <div className="relative w-12 h-12 flex items-center justify-center group">
      <div className={`absolute inset-0 bg-gradient-to-tr from-cyan-500 to-purple-600 rounded-xl rotate-12 blur-sm opacity-50 group-hover:rotate-45 transition-transform duration-500`}></div>
      <div className="relative z-10 text-2xl group-hover:scale-110 transition-transform">🚀</div>
      <div className="absolute -top-1 -right-1 z-20 text-xs animate-bounce">🧠</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute top-0 right-0 w-[600px] h-[600px] bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 blur-[140px] rounded-full transition-colors duration-1000`}></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-500/10 blur-[140px] rounded-full"></div>
      </div>

      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <RocketBrainLogo />
          <div>
            <h1 className="font-header text-xl font-bold tracking-tighter leading-none text-white">FUTUREPREP</h1>
            <p className="text-[10px] mono text-cyan-400 font-bold uppercase tracking-widest">Persistence v3.6</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="hidden lg:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            <button 
              onClick={() => setLanguagePreference('english')}
              className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${languagePreference === 'english' ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-slate-300'}`}
            >ENGLISH</button>
            <button 
              onClick={() => setLanguagePreference('hinglish')}
              className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${languagePreference === 'hinglish' ? 'bg-white text-slate-900' : 'text-slate-500 hover:text-slate-300'}`}
            >HINGLISH</button>
          </div>
          <div className="hidden md:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            <button onClick={() => setAvatarGender('male')} disabled={isLive} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'male' ? 'bg-cyan-500 text-white' : 'text-slate-500'}`}>MALE</button>
            <button onClick={() => setAvatarGender('female')} disabled={isLive} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'female' ? 'bg-pink-500 text-white' : 'text-slate-500'}`}>FEMALE</button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 max-w-6xl mx-auto w-full z-10">
        {view === 'dashboard' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <section className="text-center space-y-6">
              <h2 className="text-4xl md:text-7xl font-header font-black leading-none text-white italic">
                {languagePreference === 'hinglish' ? 'READY HAIN AAP?' : 'ENGAGE THE CORE'}
              </h2>
              <p className="text-slate-400 text-lg max-w-xl mx-auto font-medium">
                {languagePreference === 'hinglish' 
                  ? 'Aapki progress automatically save ho rahi hai. Kahin se bhi resume karein.' 
                  : 'Your progress is synchronized across sessions. Resume from any point.'}
              </p>
            </section>

            <div className="max-w-2xl mx-auto relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
              <div className="relative glass rounded-3xl p-2 flex flex-col">
                <div className="flex items-center">
                  <div className="pl-6 text-2xl">🔍</div>
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search Tech Modules..."
                    className="w-full bg-transparent p-6 text-xl focus:outline-none text-white font-medium placeholder-slate-600"
                  />
                  {isSearching && <div className="pr-6 animate-spin text-cyan-400">⚙️</div>}
                </div>
                {selectedTechs.length > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2 animate-in fade-in duration-300">
                    {selectedTechs.map(tech => (
                      <div key={tech} className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/40 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 text-xs font-bold`}>
                        <span className="text-white">{tech}</span>
                        <button onClick={() => toggleTech(tech)} className="text-slate-400 hover:text-white transition-colors">×</button>
                      </div>
                    ))}
                    <button onClick={clearSessionData} className="text-[10px] text-slate-500 uppercase tracking-widest hover:text-red-400 transition-colors ml-2 font-bold">Clear All</button>
                  </div>
                )}
              </div>
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-4 glass rounded-2xl overflow-hidden border border-white/10 z-20 shadow-2xl">
                  {suggestions.map((tech, i) => (
                    <button key={i} onClick={() => toggleTech(tech)} className="w-full text-left px-8 py-4 hover:bg-white/10 transition-colors flex items-center justify-between group">
                      <span className="text-slate-200 font-bold">{tech}</span>
                      <span className="opacity-0 group-hover:opacity-100 text-cyan-400 text-xs font-bold uppercase tracking-tighter">+ LOAD MODULE</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTechs.length > 0 && (
              <div className="animate-in zoom-in-95 duration-500 space-y-10 text-center">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                  <div onClick={() => setSessionMode('interview')} className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-1 ${sessionMode === 'interview' ? 'border-cyan-500 bg-cyan-500/5' : 'border-white/5'}`}>
                    <div className="text-6xl mb-6">⚔️</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic text-white">Elite Interview</h3>
                    <p className="text-slate-400 text-sm">Strict evaluation. Progress is synchronized.</p>
                  </div>
                  <div onClick={() => setSessionMode('prep')} className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-1 ${sessionMode === 'prep' ? 'border-purple-500 bg-purple-500/5' : 'border-white/5'}`}>
                    <div className="text-6xl mb-6">🧠</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic text-white">Advanced Prep</h3>
                    <p className="text-slate-400 text-sm">Persistent mentoring. Pick up where you left off.</p>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row items-center justify-center gap-4">
                  <button onClick={() => { clearSessionData(); setView('session'); startLiveSession(false); }} className="px-10 py-6 rounded-2xl bg-white text-slate-900 font-black text-xl hover:scale-105 active:scale-95 transition-all">NEW SESSION</button>
                  {(conversationHistory.length > 0 || masteryStage > 1) && (
                    <div className="relative group">
                      <div className="absolute -inset-1 bg-cyan-400 blur opacity-20 group-hover:opacity-60 transition duration-1000 animate-pulse"></div>
                      <button onClick={() => { setView('session'); startLiveSession(true); }} className="relative px-10 py-6 rounded-2xl bg-gradient-to-r from-cyan-600 to-purple-600 text-white font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all">
                        RESUME (STAGE {masteryStage})
                      </button>
                    </div>
                  )}
                </div>
                {lastActiveTime && (
                  <p className="text-[10px] text-slate-500 mono uppercase tracking-widest">Last synced: {lastActiveTime}</p>
                )}
              </div>
            )}
          </div>
        )}

        {view === 'session' && (
          <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-12 animate-in zoom-in-95 duration-500 relative">
            <div className="absolute top-0 left-0 scanner"></div>
            <div className="relative group">
              <div className={`absolute -inset-24 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 blur-[120px] rounded-full opacity-60 transition-opacity duration-1000`} />
              <div className={`relative w-80 h-80 rounded-[80px] border-4 ${avatarGender === 'male' ? 'border-cyan-500 shadow-[0_0_40px_rgba(6,182,212,0.2)]' : 'border-pink-500 shadow-[0_0_40px_rgba(236,72,153,0.2)]'} flex items-center justify-center bg-slate-950 overflow-hidden`}>
                <div className={`flex flex-col items-center transition-all duration-500 ${isLive ? 'scale-110' : 'scale-100'} ${avatarGender === 'male' ? 'avatar-glow-male' : 'avatar-glow-female'}`}>
                  <span className="text-9xl mb-4 select-none">{avatarGender === 'male' ? '🤖' : '👩‍🚀'}</span>
                </div>
                {isLive && (
                  <div className="absolute inset-x-0 bottom-12 flex items-end justify-center space-x-1.5 px-10">
                    {[5,8,4,12,6,14,4,9,7,13,5,8,6].map((h, i) => (
                      <div key={i} className={`flex-1 ${avatarGender === 'male' ? 'bg-cyan-500' : 'bg-pink-500'} rounded-full animate-bounce`} style={{ height: `${h * 4}px`, animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="text-center space-y-4">
              <div className="w-full max-w-md mx-auto h-2 bg-slate-800 rounded-full overflow-hidden mb-6 border border-white/5">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-1000" style={{ width: `${(masteryStage / 4) * 100}%` }} />
              </div>
              <h2 className="text-3xl font-header font-black tracking-tighter text-white uppercase italic">
                STAGE {masteryStage} // {languagePreference.toUpperCase()} MODE
              </h2>
            </div>

            <div className="flex flex-col items-center space-y-8 w-full">
              {!isLive ? (
                <button onClick={() => startLiveSession(conversationHistory.length > 0)} className="px-20 py-8 rounded-3xl bg-white text-slate-950 font-black text-3xl shadow-2xl hover:scale-105 transition-all uppercase italic">Establish Uplink</button>
              ) : (
                <div className="flex flex-col items-center space-y-6 w-full">
                  <button onClick={stopSession} className="px-20 py-8 rounded-3xl bg-red-600 text-white font-black text-3xl shadow-red-500/30 shadow-2xl hover:bg-red-700 transition-all hover:scale-105 active:scale-95">CLOSE CONNECTION</button>
                  <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Syncing Session to Matrix...</p>
                </div>
              )}
              {isLive && (
                <div className="flex items-center space-x-4 text-red-500 animate-pulse font-mono font-bold text-lg bg-red-500/5 border border-red-500/20 px-8 py-3 rounded-full shadow-[0_0_20px_rgba(239,44,44,0.1)]">
                  <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_15px_red]" />
                  <span>TRANSMITTING...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'feedback' && (
          <div className="max-w-4xl mx-auto space-y-10 py-12 animate-in slide-in-from-bottom-12 duration-1000">
             <div className="text-center space-y-4">
                <div className="inline-block px-6 py-2 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-black tracking-widest border border-cyan-500/20 uppercase">Session Snapshot</div>
                <h2 className="text-6xl font-header font-black text-white italic tracking-tighter">DATA RETRIEVED</h2>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-cyan-500 shadow-cyan-500/10">
                  <div className="text-6xl font-header font-black mb-2 text-white">96</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Tech Depth</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-purple-500">
                  <div className="text-6xl font-header font-black mb-2 text-white">{masteryStage}</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Stage Cleared</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-pink-500">
                  <div className="text-6xl font-header font-black mb-2 text-white">S</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Adaptability</div>
                </div>
             </div>
             <div className="glass p-10 rounded-[40px] border border-white/5 space-y-6">
                <h3 className="text-xl font-bold text-white uppercase tracking-widest font-header">Strategic Notes</h3>
                <p className="text-slate-400 leading-relaxed italic">"Your architectural understanding is expanding. Reaching Stage {masteryStage} is a solid milestone. Focus on edge-case recovery next session."</p>
             </div>
             <button onClick={() => { setView('dashboard'); setSearchTerm(''); }} className="w-full py-8 rounded-3xl bg-white text-slate-950 font-black text-2xl hover:bg-slate-200 transition-all shadow-2xl active:scale-95">RETURN TO MATRIX</button>
          </div>
        )}
      </main>

      <footer className="p-8 text-center text-slate-600 text-[10px] tracking-[0.5em] font-mono uppercase opacity-40">
        FuturePrep // v3.6.0 // Hinglish Module Loaded // Drive Persistence: 100%
      </footer>
    </div>
  );
};

export default App;
