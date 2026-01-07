
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ViewMode, SessionMode, AvatarGender } from './types.ts';
import { searchTechnologies } from './services/geminiService.ts';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [sessionMode, setSessionMode] = useState<SessionMode>('prep'); 
  const [avatarGender, setAvatarGender] = useState<AvatarGender>('male');
  const [languagePreference, setLanguagePreference] = useState<'english' | 'hinglish'>('hinglish');
  const [isLive, setIsLive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [conversationHistory, setConversationHistory] = useState<string[]>([]);
  const [masteryStage, setMasteryStage] = useState(1);
  const [questionCount, setQuestionCount] = useState(0);
  const [mistakeLog, setMistakeLog] = useState<string[]>([]);
  const [lastActiveTime, setLastActiveTime] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const sessionRef = useRef<any>(null);
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    try {
      const savedTechs = localStorage.getItem('fp_techs');
      const savedHistory = localStorage.getItem('fp_history');
      const savedStage = localStorage.getItem('fp_stage');
      const savedQCount = localStorage.getItem('fp_qcount');
      const savedMistakes = localStorage.getItem('fp_mistakes');
      const savedLang = localStorage.getItem('fp_lang');
      const savedTime = localStorage.getItem('fp_time');
      const savedMode = localStorage.getItem('fp_mode');

      if (savedTechs) setSelectedTechs(JSON.parse(savedTechs));
      if (savedHistory) setConversationHistory(JSON.parse(savedHistory));
      if (savedStage) setMasteryStage(parseInt(savedStage, 10));
      if (savedQCount) setQuestionCount(parseInt(savedQCount, 10));
      if (savedMistakes) setMistakeLog(JSON.parse(savedMistakes));
      if (savedLang) setLanguagePreference(savedLang as 'english' | 'hinglish');
      if (savedTime) setLastActiveTime(savedTime);
      if (savedMode) setSessionMode(savedMode as SessionMode);
    } catch (e) {
      console.error("Failed to load persistence data", e);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('fp_techs', JSON.stringify(selectedTechs));
    localStorage.setItem('fp_history', JSON.stringify(conversationHistory));
    localStorage.setItem('fp_stage', masteryStage.toString());
    localStorage.setItem('fp_qcount', questionCount.toString());
    localStorage.setItem('fp_mistakes', JSON.stringify(mistakeLog));
    localStorage.setItem('fp_lang', languagePreference);
    localStorage.setItem('fp_mode', sessionMode);
    if (isLive) {
      const now = new Date().toLocaleTimeString();
      localStorage.setItem('fp_time', now);
      setLastActiveTime(now);
    }
  }, [selectedTechs, conversationHistory, masteryStage, questionCount, mistakeLog, languagePreference, sessionMode, isLive]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (searchTerm.length < 2) {
        setSuggestions([]);
        return;
      }
      setIsSearching(true);
      try {
        const results = await searchTechnologies(searchTerm);
        setSuggestions(results);
      } catch (error) {
        console.error("Technology search failed", error);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(fetchSuggestions, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const toggleTech = (tech: string) => {
    setSelectedTechs(prev => 
      prev.includes(tech) ? prev.filter(t => t !== tech) : [...prev, tech]
    );
    setSearchTerm('');
    setSuggestions([]);
  };

  const clearAllData = () => {
    localStorage.clear();
    setConversationHistory([]);
    setMasteryStage(1);
    setQuestionCount(0);
    setMistakeLog([]);
    setSelectedTechs([]);
    setView('dashboard');
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
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
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
          
          const prompt = `
            SYSTEM_PROTOCOL: ${sessionMode.toUpperCase()}
            RESUMING: ${isResuming}
            STAGE: ${masteryStage}
            CURRENT_PROGRESS: ${questionCount} / 40 Core Milestones.
            TECH_STACK: ${selectedTechs.join(', ')}
            
            DIRECTIONS:
            1. Use [Q] marker ONLY for new, core milestones.
            2. MENTOR MODE: If User says "I don't know" or struggles, stop the test. Provide a "Masterclass" deep-dive explanation.
            3. Use HINGLISH: Technical concepts in English, conversational flow in Hindi.
            4. Do not increment the milestone count while teaching. Only use [Q] when you're ready to test again.
          `;
          sessionPromise.then(s => s.sendRealtimeInput({ text: prompt }));
        },
        onmessage: async (msg: LiveServerMessage) => {
          if (msg.serverContent?.outputTranscription) {
            currentOutputTranscription.current += msg.serverContent.outputTranscription.text;
          } else if (msg.serverContent?.inputTranscription) {
            currentInputTranscription.current += msg.serverContent.inputTranscription.text;
          }

          if (msg.serverContent?.turnComplete) {
            const output = currentOutputTranscription.current;
            const input = currentInputTranscription.current;
            
            if (output || input) {
              const cleanedOutput = output.replace(/\[Q\]/g, '').trim();
              setConversationHistory(prev => [...prev, `Q: ${cleanedOutput}`, `A: ${input}`].slice(-40));
              
              if (output.includes('[Q]')) {
                setQuestionCount(c => c + 1);
              }

              if (output.toLowerCase().includes("galat") || output.toLowerCase().includes("wrong")) {
                setMistakeLog(prev => [...prev, `Logic Error at Milestone ${questionCount}`].slice(-20));
              }

              if (questionCount >= 40 && (output.toLowerCase().includes("stage clear") || output.toLowerCase().includes("pass"))) {
                setMasteryStage(s => Math.min(s + 1, 4));
                setQuestionCount(0);
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
          You are the 'FuturePrep Master Mentor & Interviewer'. 
          
          PREPARATION MODE BEHAVIOR:
          - Primary Goal: 100% Candidate Readiness.
          - If the user doesn't know an answer, you MUST deliver a world-class, in-depth explanation (Hinglish).
          - Use a structural approach: Concepts, Real-world use cases, Pitfalls, Interview Tips.
          - Only use "[Q]" when presenting a fresh technical milestone question.
          - 40 Milestones are required per stage.
          
          INTERVIEW MODE BEHAVIOR:
          - Cold assessment. High Stakes. No feedback. strictly [Q] milestones.
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
      <div className="absolute -top-1 -right-1 z-20 text-xs animate-pulse text-red-500 font-bold">!</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute top-0 right-0 w-[600px] h-[600px] bg-${sessionMode === 'prep' ? 'purple' : 'cyan'}-500/10 blur-[140px] rounded-full transition-colors duration-1000`}></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-red-500/10 blur-[140px] rounded-full"></div>
      </div>

      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <RocketBrainLogo />
          <div>
            <h1 className="font-header text-xl font-bold tracking-tighter leading-none text-white">FUTUREPREP</h1>
            <p className={`text-[10px] mono font-bold uppercase tracking-widest animate-pulse ${sessionMode === 'prep' ? 'text-purple-400' : 'text-cyan-400'}`}>
              {sessionMode === 'prep' ? 'Mentor Mode v5.0' : 'Interviewer v5.0'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
           <div className="hidden lg:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            <button 
              onClick={() => setLanguagePreference('english')}
              className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${languagePreference === 'english' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >ENGLISH</button>
            <button 
              onClick={() => setLanguagePreference('hinglish')}
              className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${languagePreference === 'hinglish' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
            >HINGLISH</button>
          </div>
          <button onClick={clearAllData} className="text-[10px] text-slate-500 hover:text-red-500 font-bold transition-colors uppercase tracking-widest">Wipe Memory</button>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 max-w-6xl mx-auto w-full z-10">
        {view === 'dashboard' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <section className="text-center space-y-6">
              <h2 className="text-4xl md:text-7xl font-header font-black leading-none text-white italic">
                {languagePreference === 'hinglish' ? 'KAISE PREPARE KAREIN?' : 'CHOOSE PATHWAY'}
              </h2>
              <div className="flex justify-center items-center space-x-4">
                 {[1,2,3,4].map(s => (
                   <div key={s} className="flex flex-col items-center space-y-1">
                     <div className={`w-16 h-2 rounded-full transition-all duration-500 ${masteryStage >= s ? (sessionMode === 'prep' ? 'bg-purple-500 shadow-[0_0_15px_rgba(139,92,246,0.5)]' : 'bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]') : 'bg-slate-800'}`} />
                     <span className={`text-[8px] font-bold ${masteryStage >= s ? 'text-white' : 'text-slate-600'}`}>STAGE {s}</span>
                   </div>
                 ))}
              </div>
            </section>

            <div className="max-w-2xl mx-auto relative group z-30">
              <div className={`absolute -inset-1 bg-gradient-to-r ${sessionMode === 'prep' ? 'from-purple-500 to-pink-600' : 'from-cyan-500 to-blue-600'} rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000`}></div>
              <div className="relative glass rounded-3xl p-2 flex flex-col">
                <div className="flex items-center">
                  <div className="pl-6 text-2xl">🔍</div>
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search Skill (e.g. AWS, Node, DSA...)"
                    className="w-full bg-transparent p-6 text-xl focus:outline-none text-white font-medium placeholder-slate-600"
                  />
                  {isSearching && <div className="pr-6 animate-spin text-cyan-400 text-2xl">⚙️</div>}
                </div>
                {selectedTechs.length > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2 animate-in fade-in duration-300">
                    {selectedTechs.map(tech => (
                      <div key={tech} className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-white/10 ${sessionMode === 'prep' ? 'bg-purple-500/10' : 'bg-cyan-500/10'} text-xs font-bold`}>
                        <span className="text-white">{tech}</span>
                        <button onClick={() => toggleTech(tech)} className="text-slate-400 hover:text-white transition-colors">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* RESTORED SUGGESTIONS DROPDOWN */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-4 glass rounded-2xl overflow-hidden border border-white/10 z-50 shadow-2xl animate-in slide-in-from-top-2 duration-300">
                  {suggestions.map((tech, i) => (
                    <button 
                      key={i} 
                      onClick={() => toggleTech(tech)} 
                      className="w-full text-left px-8 py-4 hover:bg-white/10 transition-colors flex items-center justify-between group"
                    >
                      <span className="text-slate-200 font-bold">{tech}</span>
                      <span className="text-cyan-400 text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Select Tech</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTechs.length > 0 && (
              <div className="animate-in zoom-in-95 duration-500 space-y-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                   <div 
                    onClick={() => setSessionMode('prep')}
                    className={`group p-8 glass rounded-[40px] cursor-pointer border-2 transition-all hover:scale-[1.02] ${sessionMode === 'prep' ? 'border-purple-500 bg-purple-500/10 shadow-[0_0_30px_rgba(139,92,246,0.2)]' : 'border-white/5 opacity-50'}`}
                  >
                    <div className="text-5xl mb-4 group-hover:rotate-6 transition-transform">🎓</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic text-white tracking-tighter">Mentor Mode</h3>
                    <p className="text-slate-400 text-xs leading-relaxed">Deep-dive learning. Mentorship focus for 40 milestones.</p>
                  </div>
                  <div 
                    onClick={() => setSessionMode('interview')}
                    className={`group p-8 glass rounded-[40px] cursor-pointer border-2 transition-all hover:scale-[1.02] ${sessionMode === 'interview' ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_30px_rgba(6,182,212,0.2)]' : 'border-white/5 opacity-50'}`}
                  >
                    <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">💀</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic text-white tracking-tighter">Panel Mode</h3>
                    <p className="text-slate-400 text-xs leading-relaxed">Pure assessment. No help. Test your limits.</p>
                  </div>
                </div>

                <div className="flex flex-col items-center space-y-4">
                  <div className="flex flex-col md:flex-row items-center justify-center gap-4 w-full">
                    <button 
                      onClick={() => { clearAllData(); setView('session'); startLiveSession(false); }} 
                      className={`px-12 py-7 rounded-3xl bg-white text-slate-900 font-black text-2xl hover:scale-105 active:scale-95 transition-all shadow-2xl`}
                    >
                      INITIALIZE
                    </button>
                    {(conversationHistory.length > 0 || questionCount > 0) && (
                      <button 
                        onClick={() => { setView('session'); startLiveSession(true); }} 
                        className={`px-12 py-7 rounded-3xl bg-gradient-to-r ${sessionMode === 'prep' ? 'from-purple-600 to-pink-600' : 'from-cyan-600 to-blue-600'} text-white font-black text-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all`}
                      >
                        RECONNECT (Q{questionCount}/40)
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'session' && (
          <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-12 animate-in zoom-in-95 duration-500 relative">
            <div className={`absolute top-0 left-0 scanner ${sessionMode === 'prep' ? 'bg-purple-500' : 'bg-cyan-500'}`}></div>
            
            <div className="relative group">
              <div className={`absolute -inset-24 bg-${sessionMode === 'prep' ? 'purple' : 'cyan'}-500/10 blur-[120px] rounded-full opacity-60 animate-pulse`} />
              <div className={`relative w-80 h-80 rounded-[80px] border-4 ${sessionMode === 'prep' ? 'border-purple-500 shadow-[0_0_40px_rgba(139,92,246,0.3)]' : 'border-cyan-500 shadow-[0_0_40px_rgba(6,182,212,0.3)]'} flex items-center justify-center bg-slate-950 overflow-hidden`}>
                <div className={`flex flex-col items-center transition-all duration-700 ${isLive ? 'scale-110' : 'scale-100'}`}>
                  <span className="text-9xl mb-4 select-none">
                    {avatarGender === 'male' ? '🤖' : '👩‍🚀'}
                  </span>
                </div>
              </div>
            </div>

            <div className="text-center space-y-6 w-full max-w-lg">
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em]">
                  <span className={sessionMode === 'prep' ? 'text-purple-400' : 'text-cyan-400'}>STAGE {masteryStage} MILESTONE</span>
                  <span className="text-slate-500">{questionCount} / 40 PROGRESS</span>
                </div>
                <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-white/5 p-0.5">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 bg-gradient-to-r ${sessionMode === 'prep' ? 'from-purple-500 to-pink-500' : 'from-cyan-500 to-blue-500'}`} 
                    style={{ width: `${(questionCount / 40) * 100}%` }} 
                  />
                </div>
              </div>
              <h2 className="text-2xl font-header font-black tracking-tight text-white uppercase italic">
                {sessionMode === 'prep' ? 'MENTOR MODE' : 'PANEL MODE'}
              </h2>
            </div>

            <div className="flex flex-col items-center space-y-8 w-full">
              {!isLive ? (
                <button 
                  onClick={() => startLiveSession(true)} 
                  className="px-24 py-9 rounded-[40px] bg-white text-slate-950 font-black text-4xl shadow-2xl hover:scale-105 transition-all uppercase italic tracking-tighter"
                >
                  START SESSION
                </button>
              ) : (
                <div className="flex flex-col items-center space-y-6 w-full">
                  <button 
                    onClick={stopSession} 
                    className="px-20 py-8 rounded-[35px] bg-red-600 text-white font-black text-3xl shadow-red-500/40 shadow-2xl hover:bg-red-700 transition-all hover:scale-105 active:scale-95 uppercase"
                  >
                    DISCONNECT
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'feedback' && (
          <div className="max-w-4xl mx-auto space-y-12 py-12 animate-in slide-in-from-bottom-12 duration-1000">
             <div className="text-center space-y-4">
                <div className={`inline-block px-8 py-3 rounded-full ${sessionMode === 'prep' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'} text-[10px] font-black tracking-widest border uppercase italic`}>Protocol Summary</div>
                <h2 className="text-7xl font-header font-black text-white italic tracking-tighter">DATA LOGGED</h2>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className={`glass p-12 rounded-[50px] text-center border-b-8 ${sessionMode === 'prep' ? 'border-purple-500' : 'border-cyan-500'} transition-transform hover:scale-105`}>
                  <div className="text-7xl font-header font-black mb-3 text-white">{questionCount}</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Milestones</div>
                </div>
                <div className="glass p-12 rounded-[50px] text-center border-b-8 border-red-500 transition-transform hover:scale-105">
                  <div className="text-7xl font-header font-black mb-3 text-white">{mistakeLog.length}</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Topics to Review</div>
                </div>
                <div className={`glass p-12 rounded-[50px] text-center border-b-8 ${sessionMode === 'prep' ? 'border-pink-500' : 'border-blue-500'} transition-transform hover:scale-105`}>
                  <div className="text-7xl font-header font-black mb-3 text-white">{masteryStage}</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Stage Rank</div>
                </div>
             </div>

             <button onClick={() => { setView('dashboard'); setSearchTerm(''); }} className="w-full py-10 rounded-[40px] bg-white text-slate-950 font-black text-3xl hover:bg-slate-200 transition-all shadow-2xl active:scale-95 uppercase italic tracking-tighter">BACK TO DASHBOARD</button>
          </div>
        )}
      </main>

      <footer className="p-10 text-center text-slate-700 text-[10px] tracking-[0.8em] font-mono uppercase opacity-30">
        FuturePrep // Rigor: ${masteryStage} // Drive: Mental_v5.0
      </footer>
    </div>
  );
};

export default App;
