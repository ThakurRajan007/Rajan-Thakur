
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { ViewMode, SessionMode, AvatarGender, Track, User, SessionResult } from './types';
import { getPrepExplanation, generateSessionFeedback, searchTechnologies } from './services/geminiService';

const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('dashboard');
  const [sessionMode, setSessionMode] = useState<SessionMode>('interview');
  const [avatarGender, setAvatarGender] = useState<AvatarGender>('male');
  const [isLive, setIsLive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  
  const [users, setUsers] = useState<User[]>([
    { id: '1', name: 'Elite Candidate', email: 'user@future.io', subscriptionEnd: Date.now() + 1000000000, tier: '6-month' }
  ]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.length >= 2 && !selectedTech) {
        setIsSearching(true);
        const results = await searchTechnologies(searchTerm);
        setSuggestions(results);
        setIsSearching(false);
      } else if (searchTerm.length < 2) {
        setSuggestions([]);
      }
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, selectedTech]);

  const startLiveSession = async () => {
    if (!selectedTech) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    setIsLive(true);
    
    const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    audioContextRef.current = outputCtx;

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
            sessionPromise.then(s => s.sendRealtimeInput({ 
              media: { data: btoa(String.fromCharCode(...new Uint8Array(int16.buffer))), mimeType: 'audio/pcm;rate=16000' }
            }));
          };
          source.connect(processor);
          processor.connect(inputCtx.destination);
          
          // Initial greeting
          sessionPromise.then(s => s.sendRealtimeInput({ 
            text: `Hello! I am your ${avatarGender} AI ${sessionMode === 'interview' ? 'interviewer' : 'mentor'} for ${selectedTech}. Let's begin.` 
          }));
        },
        onmessage: async (msg: LiveServerMessage) => {
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
          }
        },
        onclose: () => setIsLive(false),
        onerror: (e) => console.error("Live Error", e)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: avatarGender === 'male' ? 'Zephyr' : 'Kore' } }
        },
        systemInstruction: `
          You are a highly advanced AI system named FuturePrep.
          MODE: ${sessionMode.toUpperCase()}
          TECHNOLOGY: ${selectedTech}
          AVATAR: ${avatarGender.toUpperCase()}
          
          If INTERVIEW: Be formal, challenging, and ask one deep technical question at a time.
          If PREP: Be helpful, explain concepts clearly, and guide the user through complex areas.
          Always speak as the persona of a senior technical leader.
        `
      }
    });

    sessionRef.current = await sessionPromise;
  };

  const stopSession = () => {
    if (sessionRef.current) sessionRef.current.close();
    setIsLive(false);
    setView('feedback');
  };

  const RocketBrainLogo = () => (
    <div className="relative w-12 h-12 flex items-center justify-center">
      <div className={`absolute inset-0 bg-gradient-to-tr from-cyan-500 to-purple-600 rounded-xl rotate-12 blur-sm opacity-50`}></div>
      <div className="relative z-10 text-2xl">🚀</div>
      <div className="absolute -top-1 -right-1 z-20 text-xs">🧠</div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <RocketBrainLogo />
          <div>
            <h1 className="font-header text-xl font-bold tracking-tighter leading-none text-white">FUTUREPREP</h1>
            <p className="text-[10px] mono text-cyan-400 font-bold uppercase tracking-widest">Career Launchpad</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="hidden md:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            <button 
              onClick={() => setAvatarGender('male')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'male' ? 'bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]' : 'text-slate-500 hover:text-slate-300'}`}
            >MALE AI</button>
            <button 
              onClick={() => setAvatarGender('female')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${avatarGender === 'female' ? 'bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)]' : 'text-slate-500 hover:text-slate-300'}`}
            >FEMALE AI</button>
          </div>
          <button onClick={() => setView('admin')} className="text-xs font-header hover:text-cyan-400 transition-colors uppercase tracking-widest">Admin</button>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 max-w-6xl mx-auto w-full">
        {view === 'dashboard' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <section className="text-center space-y-6">
              <h2 className="text-4xl md:text-7xl font-header font-black leading-none text-white">
                TARGET YOUR <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500">CAREER</span>
              </h2>
              <p className="text-slate-400 text-lg max-w-xl mx-auto font-medium">
                The world's most advanced AI interview simulator. Select a technology to begin your transformation.
              </p>
            </section>

            {/* Search Box */}
            <div className="max-w-2xl mx-auto relative group">
              <div className={`absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200`}></div>
              <div className="relative glass rounded-3xl p-2 flex items-center">
                <div className="pl-6 text-2xl">🔍</div>
                <input 
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setSelectedTech('');
                  }}
                  placeholder="Search Technology (e.g. VMware, Robotics, React...)"
                  className="w-full bg-transparent p-6 text-xl focus:outline-none text-white font-medium placeholder-slate-600"
                />
                {isSearching && <div className="pr-6 animate-spin">⚙️</div>}
              </div>

              {suggestions.length > 0 && !selectedTech && (
                <div className="absolute top-full left-0 right-0 mt-4 glass rounded-2xl overflow-hidden border border-white/10 z-20 shadow-2xl">
                  {suggestions.map((tech, i) => (
                    <button 
                      key={i}
                      onClick={() => {
                        setSelectedTech(tech);
                        setSearchTerm(tech);
                        setSuggestions([]);
                      }}
                      className="w-full text-left px-8 py-4 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0 flex items-center justify-between group"
                    >
                      <span className="text-slate-200 font-bold">{tech}</span>
                      <span className="opacity-0 group-hover:opacity-100 text-cyan-400 text-xs font-bold uppercase tracking-tighter">Select Target →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTech && (
              <div className="animate-in zoom-in-95 duration-500 space-y-10 text-center">
                <div className="inline-block glass px-8 py-3 rounded-full border border-cyan-500/30 text-cyan-400 font-bold tracking-widest uppercase text-sm">
                  Active Target: {selectedTech}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                  <div 
                    onClick={() => setSessionMode('interview')}
                    className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-2 ${sessionMode === 'interview' ? 'border-cyan-500 bg-cyan-500/5' : 'border-white/5 hover:border-white/20'}`}
                  >
                    <div className="text-6xl mb-6 group-hover:scale-110 transition-transform">🤺</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic tracking-tighter">Interview Mode</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">High-pressure simulation with a strict senior technical panel. Realistic feedback and score.</p>
                  </div>
                  <div 
                    onClick={() => setSessionMode('prep')}
                    className={`group p-10 glass rounded-[40px] cursor-pointer border-2 transition-all hover:-translate-y-2 ${sessionMode === 'prep' ? 'border-purple-500 bg-purple-500/5' : 'border-white/5 hover:border-white/20'}`}
                  >
                    <div className="text-6xl mb-6 group-hover:scale-110 transition-transform">🎓</div>
                    <h3 className="text-2xl font-black mb-2 uppercase italic tracking-tighter">Preparation Mode</h3>
                    <p className="text-slate-400 text-sm leading-relaxed">Interactive deep-dive with a mentor. Ask anything, get text-book definitions and analogies.</p>
                  </div>
                </div>

                <button 
                  onClick={() => setView('session')}
                  className={`px-16 py-6 rounded-2xl bg-gradient-to-r from-cyan-600 to-purple-600 text-white font-black text-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all shadow-cyan-500/20`}
                >
                  INITIATE {sessionMode.toUpperCase()}
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'session' && (
          <div className="h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-12 animate-in zoom-in-95 duration-500 relative">
            <div className="absolute top-0 left-0 scanner"></div>
            
            {/* Avatar Visualization */}
            <div className="relative">
              <div className={`absolute -inset-10 bg-${avatarGender === 'male' ? 'cyan' : 'pink'}-500/20 blur-[100px] rounded-full ${isLive ? 'animate-pulse' : ''}`} />
              <div className={`relative w-72 h-72 rounded-[60px] border-4 ${avatarGender === 'male' ? 'border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]' : 'border-pink-500 shadow-[0_0_30px_rgba(236,72,153,0.3)]'} flex items-center justify-center bg-slate-900 overflow-hidden`}>
                <div className={`flex flex-col items-center ${avatarGender === 'male' ? 'avatar-glow-male' : 'avatar-glow-female'}`}>
                  <span className="text-8xl mb-4">{avatarGender === 'male' ? '🤖' : '👩‍🚀'}</span>
                  <div className="h-1.5 w-24 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${avatarGender === 'male' ? 'bg-cyan-500' : 'bg-pink-500'} ${isLive ? 'animate-[shimmer_2s_infinite]' : 'w-1/3'}`}></div>
                  </div>
                </div>
                
                {isLive && (
                  <div className="absolute inset-x-0 bottom-8 flex items-end justify-center space-x-1.5 px-10">
                    {[1,2,3,4,3,2,4,1,2,3,5,2,1].map((h, i) => (
                      <div key={i} className={`flex-1 ${avatarGender === 'male' ? 'bg-cyan-500' : 'bg-pink-500'} rounded-full animate-bounce`} style={{ height: `${h * 6}px`, animationDelay: `${i * 100}ms` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="text-center space-y-4">
              <h2 className="text-5xl font-header font-black tracking-tighter text-white">
                {selectedTech.toUpperCase()}
              </h2>
              <div className="flex items-center justify-center space-x-3">
                <span className="px-4 py-1 glass rounded-full text-[10px] font-bold tracking-widest uppercase border border-white/10">{sessionMode} PHASE</span>
                <span className={`px-4 py-1 glass rounded-full text-[10px] font-bold tracking-widest uppercase border border-white/10 text-${avatarGender === 'male' ? 'cyan' : 'pink'}-400`}>LINK_STABLE</span>
              </div>
            </div>

            <div className="flex flex-col items-center space-y-8 w-full">
              {!isLive ? (
                <button 
                  onClick={startLiveSession}
                  className="group relative px-20 py-8 rounded-3xl bg-white text-slate-950 font-black text-3xl shadow-2xl hover:scale-105 active:scale-95 transition-all overflow-hidden"
                >
                  <span className="relative z-10">COMMENCE VOICE LINK</span>
                  <div className="absolute inset-0 bg-cyan-100 translate-y-full group-hover:translate-y-0 transition-transform"></div>
                </button>
              ) : (
                <button 
                  onClick={stopSession}
                  className="px-20 py-8 rounded-3xl bg-red-600 text-white font-black text-3xl shadow-red-500/20 shadow-2xl hover:bg-red-700 transition-all hover:scale-105"
                >
                  TERMINATE & REVIEW
                </button>
              )}
              
              {isLive && (
                <div className="flex items-center space-x-4 text-red-500 animate-pulse font-mono font-bold text-lg bg-red-500/10 px-6 py-2 rounded-full">
                  <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_red]" />
                  <span>SYSTEM_LISTENING...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'feedback' && (
          <div className="max-w-4xl mx-auto space-y-10 py-12 animate-in slide-in-from-bottom-12 duration-1000">
             <div className="text-center space-y-4">
                <div className="inline-block px-6 py-2 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-black tracking-widest border border-cyan-500/20">MISSION SUMMARY</div>
                <h2 className="text-6xl font-header font-black text-white italic">ANALYSIS COMPLETE</h2>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-cyan-500">
                  <div className="text-6xl font-header font-black mb-2 text-white">88</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Tech Competency</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-purple-500">
                  <div className="text-6xl font-header font-black mb-2 text-white">A-</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Communication</div>
                </div>
                <div className="glass p-10 rounded-[40px] text-center border-b-8 border-pink-500">
                  <div className="text-6xl font-header font-black mb-2 text-white">5.8</div>
                  <div className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">Min Duration</div>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="glass p-10 rounded-[40px] border border-cyan-500/20">
                  <h4 className="font-header text-xl font-bold text-cyan-400 mb-6 uppercase tracking-widest">Core Strengths</h4>
                  <ul className="space-y-4 text-slate-300">
                    <li className="flex items-start"><span className="text-cyan-500 mr-3 mt-1">▶</span> Deep mastery of ${selectedTech} core architectures.</li>
                    <li className="flex items-start"><span className="text-cyan-500 mr-3 mt-1">▶</span> Swift adaptation to edge-case scenarios.</li>
                  </ul>
               </div>
               <div className="glass p-10 rounded-[40px] border border-pink-500/20">
                  <h4 className="font-header text-xl font-bold text-pink-400 mb-6 uppercase tracking-widest">Growth Vectors</h4>
                  <ul className="space-y-4 text-slate-300">
                    <li className="flex items-start"><span className="text-pink-500 mr-3 mt-1">▶</span> Clarify performance scaling constraints.</li>
                    <li className="flex items-start"><span className="text-pink-500 mr-3 mt-1">▶</span> Use more specific case-studies when prompted.</li>
                  </ul>
               </div>
             </div>

             <button 
              onClick={() => {
                setView('dashboard');
                setSelectedTech('');
                setSearchTerm('');
              }}
              className="w-full py-8 rounded-3xl bg-white text-slate-950 font-black text-2xl hover:bg-slate-200 transition-all shadow-2xl hover:scale-[1.01]"
             >RE-INITIALIZE CAREER DRIVE</button>
          </div>
        )}

        {view === 'admin' && (
          <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500">
            <h2 className="text-4xl font-header font-black uppercase italic tracking-tighter">Command Center</h2>
            <div className="glass p-10 rounded-[40px] border border-white/10 space-y-8">
              <h3 className="text-xl font-bold flex items-center text-cyan-400 tracking-widest uppercase"><span className="mr-3">⚡</span> Provision Access Token</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <input className="bg-slate-900/50 border border-white/10 p-5 rounded-2xl focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="Full Name" />
                <input className="bg-slate-900/50 border border-white/10 p-5 rounded-2xl focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="Target Email" />
                <select className="bg-slate-900/50 border border-white/10 p-5 rounded-2xl focus:ring-2 focus:ring-cyan-500 outline-none col-span-full">
                  <option>1 Month Strategic Access</option>
                  <option>4 Month Professional Tier</option>
                  <option>6 Month Elite Launchpad</option>
                </select>
                <button className="bg-cyan-600 p-6 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-cyan-600/20 col-span-full hover:bg-cyan-500 transition-colors">AUTHORIZE SEAT</button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="p-8 text-center text-slate-600 text-[10px] tracking-[0.5em] font-mono uppercase opacity-50">
        Engine Protocol v3.0.0 // Hyper-Threaded Learning // FuturePrep System
      </footer>
    </div>
  );
};

export default App;
