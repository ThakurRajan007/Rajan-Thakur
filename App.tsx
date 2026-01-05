
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ViewMode, SessionMode, AvatarGender, User, SessionResult } from './types';
import { generateSessionFeedback, searchTechnologies } from './services/geminiService';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [sessionMode, setSessionMode] = useState<SessionMode>('interview');
  const [avatarGender, setAvatarGender] = useState<AvatarGender>('male');
  const [isLive, setIsLive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [users, setUsers] = useState<User[]>([
    { id: '1', name: 'Elite Candidate', email: 'user@future.io', subscriptionEnd: Date.now() + 1000000000, tier: '6-month' }
  ]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const sessionRef = useRef<any>(null);

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

  const startLiveSession = async () => {
    if (selectedTechs.length === 0) return;
    
    // Cleanup previous contexts if they exist
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
          console.debug("Session opened");
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
            
            sessionPromise.then(s => {
              if (s) {
                s.sendRealtimeInput({ 
                  media: { data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))), mimeType: 'audio/pcm;rate=16000' }
                });
              }
            }).catch(err => console.error("Send error", err));
          };
          
          source.connect(processor);
          processor.connect(inputCtx.destination);
          
          const techList = selectedTechs.join(', ');
          const initialMessage = sessionMode === 'interview' 
            ? `System initialized. I am your senior technical panel lead. We are conducting a deep-dive evaluation on ${techList}. I expect precision and architectural depth. Let's start with a foundational assessment.`
            : `Mentor mode active. I am here to prep you for elite roles in ${techList}. I won't just wait for you to talk; I will lead the way through a multi-stage curriculum. Let's begin by examining the core architecture of ${selectedTechs[0]}.`;

          sessionPromise.then(s => s.sendRealtimeInput({ text: initialMessage }));
        },
        onmessage: async (msg: LiveServerMessage) => {
          if (msg.serverContent?.interrupted) {
            console.debug("Model interrupted by user");
            sourcesRef.current.forEach(s => {
              try { s.stop(); } catch(e) {}
            });
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
        onclose: (e) => {
          console.debug("Session closed", e);
          setIsLive(false);
        },
        onerror: (e) => {
          console.error("Live session error:", e);
          setIsLive(false);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: avatarGender === 'male' ? 'Zephyr' : 'Kore' } }
        },
        systemInstruction: `
          You are FuturePrep, the world's most advanced Career Acceleration AI.
          TARGET STACK: ${selectedTechs.join(', ')}
          MODE: ${sessionMode.toUpperCase()}
          AVATAR: ${avatarGender.toUpperCase()}
          
          CRITICAL BEHAVIOR RULES:
          1. NEVER END THE SESSION. You must continue to lead the conversation until the user explicitly terminates it.
          2. THE MASTERY LADDER: Every session must evolve through 4 distinct stages:
             STAGE 1: Fundamentals & Definition (Ensure they know the "What")
             STAGE 2: Implementation & Scenarios (Can they apply the "How"?)
             STAGE 3: System Architecture & Design (Can they scale it?)
             STAGE 4: Crisis, Edge Cases & Troubleshooting (Can they fix it when it breaks?)
          
          3. CONTINUOUS EVOLUTION: 
             - If a user answers well, immediately pivot to a more complex follow-up (e.g., "Good. Now, how would you handle that if we added a 500ms latency constraint?").
             - If a user struggles, do not end. Instead, offer a brief hint or a supporting analogy, then re-test them on a related foundational concept.
             
          4. PROACTIVE MENTORSHIP (PREP MODE): 
             - You are the driver. Do not wait for silence. If the user finishes a thought, immediately say "Excellent, let's move to the next logical step in mastering ${selectedTechs[0]}..." 
             - Use "Check-for-Understanding" mini-quizzes constantly.
             
          5. INTERVIEW RIGOR (INTERVIEW MODE): 
             - Be the 'tough but fair' architect. Dig into the 'Why' behind every answer. 
             - If the user provides a surface-level answer, respond with "That's a standard answer, but in a production environment with high availability, why would that fail?"
          
          TONE: Futuristic, highly intelligent, senior-level, and authoritative yet motivating.
          Ensure you are always monitoring for user silence and re-engaging them with new technical challenges.
        `
      }
    });

    sessionRef.current = await sessionPromise;
  };

  const stopSession = () => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch(e) {}
    }
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
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute top-0 right-0 w-[600px] h-[600px] bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 blur-[140px] rounded-full transition-colors duration-1000`}></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-500/10 blur-[140px] rounded-full"></div>
      </div>

      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <RocketBrainLogo />
          <div>
            <h1 className="font-header text-xl font-bold tracking-tighter leading-none text-white">FUTUREPREP</h1>
            <p className="text-[10px] mono text-cyan-400 font-bold uppercase tracking-widest">Mastery Engine</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="hidden md:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            <button 
              onClick={() => setAvatarGender('male')}
              disabled={isLive}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'male' ? 'bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'text-slate-500 hover:text-slate-300'} disabled:opacity-50`}
            >MALE AI</button>
            <button 
              onClick={() => setAvatarGender('female')}
              disabled={isLive}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'female' ? 'bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)]' : 'text-slate-500 hover:text-slate-300'} disabled:opacity-50`}
            >FEMALE AI</button>
          </div>
          <button onClick={() => setView('admin')} className="text-xs font-header hover:text-cyan-400 transition-colors uppercase tracking-widest">Protocol</button>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 max-w-6xl mx-auto w-full z-10">
        {view === 'dashboard' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <section className="text-center space-y-6">
              <h2 className="text-4xl md:text-7xl font-header font-black leading-none text-white italic">
                ENGAGE THE <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 underline decoration-cyan-500/20 underline-offset-8">CORE</span>
              </h2>
              <p className="text-slate-400 text-lg max-w-xl mx-auto font-medium">
                Load specific technology modules into the simulation matrix for cross-disciplinary preparation.
              </p>
            </section>

            <div className="max-w-2xl mx-auto relative group">
              <div className={`absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000`}></div>
              <div className="relative glass rounded-3xl p-2 flex flex-col">
                <div className="flex items-center">
                  <div className="pl-6 text-2xl">🔍</div>
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search Tech (e.g. VMware, NSX, Robotics...)"
                    className="w-full bg-transparent p-6 text-xl focus:outline-none text-white font-medium placeholder-slate-600"
                  />
                  {isSearching && <div className="pr-6 animate-spin text-cyan-400">⚙️</div>}
                </div>
                
                {selectedTechs.length > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2 animate-in fade-in duration-300">
                    {selectedTechs.map(tech => (
                      <div 
                        key={tech} 
                        className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/40 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 text-xs font-bold transition-all hover:bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/20`}
                      >
                        <span className="text-white">{tech}</span>
                        <button onClick={() => toggleTech(tech)} className="text-slate-400 hover:text-white transition-colors">×</button>
                      </div>
                    ))}
                    <button 
                      onClick={() => setSelectedTechs([])}
                      className="text-[10px] text-slate-500 uppercase tracking-widest hover:text-red-400 transition-colors ml-2 font-bold"
                    >Clear Simulation</button>
                  </div>
                )}
              </div>

              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-4 glass rounded-2xl overflow-hidden border border-white/10 z-20 shadow-2xl animate-in slide-in-from-top-2 duration-200">
                  {suggestions.map((tech, i) => (
                    <button 
                      key={i}
                      onClick={() => toggleTech(tech)}
                      className="w-full text-left px-8 py-4 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0 flex items-center justify-between group"
                    >
                      <span className="text-slate-200 font-bold">{tech}</span>
                      <span className={`opacity-0 group-hover:opacity-100 text-${avatarGender === 'male' ? 'cyan' : 'pink'}-400 text-xs font-bold uppercase tracking-tighter`}>+ INJECT MODULE</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTechs.length > 0 && (
              <div className="animate-in zoom-in-95 duration-500 space-y-10 text-center">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                  <div 
                    onClick={() => setSessionMode('interview')}
                    className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-1 ${sessionMode === 'interview' ? `border-${avatarGender === 'male' ? 'cyan' : 'pink'}-500 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/5` : 'border-white/5 hover:border-white/20'}`}
                  >
                    <div className="text-6xl mb-6 group-hover:rotate-12 transition-transform">⚔️</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic tracking-tighter text-white">Elite Interview</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">Rigorous architectural probe. No hints. High-stakes simulation.</p>
                  </div>
                  <div 
                    onClick={() => setSessionMode('prep')}
                    className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-1 ${sessionMode === 'prep' ? 'border-purple-500 bg-purple-500/5' : 'border-white/5 hover:border-white/20'}`}
                  >
                    <div className="text-6xl mb-6 group-hover:scale-105 transition-transform">🧠</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic tracking-tighter text-white">Advanced Prep</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">AI-led mastery ladder. Proactive guidance through complex systems.</p>
                  </div>
                </div>

                <button 
                  onClick={() => setView('session')}
                  className={`px-16 py-6 rounded-2xl bg-gradient-to-r from-${avatarGender === 'male' ? 'cyan' : 'pink'}-600 to-purple-600 text-white font-black text-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all shadow-indigo-500/30`}
                >
                  START SESSION DRIVE
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'session' && (
          <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-12 animate-in zoom-in-95 duration-500 relative">
            <div className="absolute top-0 left-0 scanner"></div>
            
            <div className="relative group">
              <div className={`absolute -inset-24 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/10 blur-[120px] rounded-full group-hover:opacity-100 opacity-60 transition-opacity duration-1000`} />
              <div className={`relative w-80 h-80 rounded-[80px] border-4 ${avatarGender === 'male' ? 'border-cyan-500 shadow-[0_0_40px_rgba(6,182,212,0.2)]' : 'border-pink-500 shadow-[0_0_40px_rgba(236,72,153,0.2)]'} flex items-center justify-center bg-slate-950 overflow-hidden`}>
                <div className={`flex flex-col items-center transition-all duration-500 ${isLive ? 'scale-110' : 'scale-100'} ${avatarGender === 'male' ? 'avatar-glow-male' : 'avatar-glow-female'}`}>
                  <span className="text-9xl mb-4 select-none">{avatarGender === 'male' ? '🤖' : '👩‍🚀'}</span>
                </div>
                
                {isLive && (
                  <div className="absolute inset-x-0 bottom-12 flex items-end justify-center space-x-1.5 px-10">
                    {[5,8,4,12,6,14,4,9,7,13,5,8,6].map((h, i) => (
                      <div key={i} className={`flex-1 ${avatarGender === 'male' ? 'bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]'} rounded-full animate-bounce`} style={{ height: `${h * 4}px`, animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="text-center space-y-4">
              <div className="flex flex-wrap justify-center gap-2">
                {selectedTechs.map(t => (
                  <span key={t} className={`px-4 py-1.5 glass rounded-full text-xs font-bold tracking-widest uppercase border border-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/30 text-${avatarGender === 'male' ? 'cyan' : 'pink'}-400`}>{t}</span>
                ))}
              </div>
              <h2 className="text-3xl font-header font-black tracking-tighter text-white uppercase italic">
                {sessionMode} SYNCHRONIZATION
              </h2>
            </div>

            <div className="flex flex-col items-center space-y-8 w-full">
              {!isLive ? (
                <button 
                  onClick={startLiveSession}
                  className="group relative px-20 py-8 rounded-3xl bg-white text-slate-950 font-black text-3xl shadow-2xl hover:scale-105 transition-all overflow-hidden"
                >
                  <span className="relative z-10 uppercase italic tracking-tight">Establish Uplink</span>
                  <div className={`absolute inset-0 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-100 translate-y-full group-hover:translate-y-0 transition-transform duration-300`}></div>
                </button>
              ) : (
                <div className="flex flex-col items-center space-y-6 w-full">
                  <button 
                    onClick={stopSession}
                    className="px-20 py-8 rounded-3xl bg-red-600 text-white font-black text-3xl shadow-red-500/30 shadow-2xl hover:bg-red-700 transition-all hover:scale-105 active:scale-95"
                  >
                    CLOSE CONNECTION
                  </button>
                  <p className="text-slate-500 font-mono text-xs uppercase tracking-widest animate-pulse">Mastery Protocol Active // Neural Response Monitored</p>
                </div>
              )}
              
              {isLive && (
                <div className="flex items-center space-x-4 text-red-500 animate-pulse font-mono font-bold text-lg bg-red-500/5 border border-red-500/20 px-8 py-3 rounded-full shadow-[0_0_20px_rgba(239,44,44,0.1)]">
                  <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_15px_red]" />
                  <span>DATA_FLOW_STABLE</span>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'feedback' && (
          <div className="max-w-4xl mx-auto space-y-10 py-12 animate-in slide-in-from-bottom-12 duration-1000">
             <div className="text-center space-y-4">
                <div className="inline-block px-6 py-2 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-black tracking-widest border border-cyan-500/20">POST-SESSION ANALYSIS</div>
                <h2 className="text-6xl font-header font-black text-white italic tracking-tighter">METRICS RETRIEVED</h2>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-cyan-500 shadow-cyan-500/10 transition-transform hover:scale-105">
                  <div className="text-6xl font-header font-black mb-2 text-white">96</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Tech Mastery</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-purple-500 shadow-purple-500/10 transition-transform hover:scale-105">
                  <div className="text-6xl font-header font-black mb-2 text-white">S</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Communication</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-pink-500 shadow-pink-500/10 transition-transform hover:scale-105">
                  <div className="text-6xl font-header font-black mb-2 text-white">9.2</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Adaptive Resilience</div>
                </div>
             </div>

             <div className="glass p-10 rounded-[40px] border border-white/5 space-y-6">
                <h3 className="text-xl font-bold text-white uppercase tracking-widest font-header">Mission Intelligence</h3>
                <p className="text-slate-400 leading-relaxed italic">"Your architectural understanding of {selectedTechs.join(' & ')} is exceptional. The evolution of your session showed high performance under increasing complexity. Maintain focus on edge-case disaster recovery for absolute mastery."</p>
             </div>

             <button 
              onClick={() => {
                setView('dashboard');
                setSelectedTechs([]);
                setSearchTerm('');
              }}
              className="w-full py-8 rounded-3xl bg-white text-slate-950 font-black text-2xl hover:bg-slate-200 transition-all shadow-2xl hover:scale-[1.01] active:scale-95"
             >RETURN TO MATRIX</button>
          </div>
        )}

        {view === 'admin' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500">
            <h2 className="text-4xl font-header font-black uppercase italic tracking-tighter text-white">Admin Terminal</h2>
            <div className="glass p-10 rounded-[40px] border border-white/10 space-y-8">
              <h3 className="text-xl font-bold flex items-center text-cyan-400 tracking-widest uppercase"><span className="mr-3">⚡</span> Provision Access Key</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <input className="bg-slate-900/50 border border-white/10 p-5 rounded-2xl outline-none text-white focus:border-cyan-500 transition-colors" placeholder="Full Name" />
                <input className="bg-slate-900/50 border border-white/10 p-5 rounded-2xl outline-none text-white focus:border-cyan-500 transition-colors" placeholder="Email Address" />
                <button className="bg-cyan-600 p-6 rounded-2xl font-black uppercase tracking-widest col-span-full hover:bg-cyan-500 transition-all shadow-lg shadow-cyan-600/20 active:scale-95">AUTHORIZE MODULE SEAT</button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="p-8 text-center text-slate-600 text-[10px] tracking-[0.5em] font-mono uppercase opacity-40">
        FuturePrep // Hyper-Integrated // v3.2.0 // Session Evolution: Enabled
      </footer>
    </div>
  );
};

export default App;
