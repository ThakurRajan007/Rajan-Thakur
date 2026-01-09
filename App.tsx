
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
  const [hasSearched, setHasSearched] = useState(false);
  
  // Persistence State
  const [conversationHistory, setConversationHistory] = useState<string[]>([]);
  const [masteryStage, setMasteryStage] = useState(1);
  const [questionCount, setQuestionCount] = useState(0);
  const [mistakeLog, setMistakeLog] = useState<string[]>([]);
  const [courseProgress, setCourseProgress] = useState(0); // Tracks current module (0-10)
  const [lastActiveTime, setLastActiveTime] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const sessionRef = useRef<any>(null);
  
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // --- PERSISTENCE ENGINE ---
  useEffect(() => {
    try {
      const saved = {
        techs: localStorage.getItem('fp_techs'),
        history: localStorage.getItem('fp_history'),
        stage: localStorage.getItem('fp_stage'),
        qCount: localStorage.getItem('fp_qcount'),
        mistakes: localStorage.getItem('fp_mistakes'),
        lang: localStorage.getItem('fp_lang'),
        time: localStorage.getItem('fp_time'),
        mode: localStorage.getItem('fp_mode'),
        course: localStorage.getItem('fp_course_progress')
      };

      if (saved.techs) setSelectedTechs(JSON.parse(saved.techs));
      if (saved.history) setConversationHistory(JSON.parse(saved.history));
      if (saved.stage) setMasteryStage(parseInt(saved.stage, 10) || 1);
      if (saved.qCount) setQuestionCount(parseInt(saved.qCount, 10) || 0);
      if (saved.mistakes) setMistakeLog(JSON.parse(saved.mistakes));
      if (saved.lang) setLanguagePreference(saved.lang as 'english' | 'hinglish');
      if (saved.time) setLastActiveTime(saved.time);
      if (saved.mode) setSessionMode(saved.mode as SessionMode);
      if (saved.course) setCourseProgress(parseInt(saved.course, 10) || 0);
    } catch (e) {
      console.error("Neural Cache Load Failure", e);
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
    localStorage.setItem('fp_course_progress', courseProgress.toString());
    if (isLive) {
      const now = new Date().toLocaleTimeString();
      localStorage.setItem('fp_time', now);
      setLastActiveTime(now);
    }
  }, [selectedTechs, conversationHistory, masteryStage, questionCount, mistakeLog, languagePreference, sessionMode, courseProgress, isLive]);

  // Search Logic
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (searchTerm.trim().length < 2) {
        setSuggestions([]);
        setHasSearched(false);
        return;
      }
      setIsSearching(true);
      try {
        const results = await searchTechnologies(searchTerm);
        setSuggestions(results);
        setHasSearched(true);
      } catch (error) {
        console.error("Technology search failed", error);
      } finally {
        setIsSearching(false);
      }
    };

    const timer = setTimeout(fetchSuggestions, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const toggleTech = (tech: string) => {
    setSelectedTechs([tech]); // Usually one main topic for a deep course/session
    setSearchTerm('');
    setSuggestions([]);
    setHasSearched(false);
  };

  const clearAllData = () => {
    if(window.confirm("RESET SYSTEM? This will wipe all progress, course modules, and history. AI will forget you.")) {
      localStorage.clear();
      setConversationHistory([]);
      setMasteryStage(1);
      setQuestionCount(0);
      setMistakeLog([]);
      setCourseProgress(0);
      setSelectedTechs([]);
      setView('dashboard');
    }
  };

  const getModeColor = () => {
    if (sessionMode === 'prep') return 'purple';
    if (sessionMode === 'study') return 'emerald';
    if (sessionMode === 'course') return 'teal';
    return 'cyan';
  };

  // --- CORE SESSION ENGINE ---
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
          
          let modeSpec = "";
          if (sessionMode === 'course') {
            modeSpec = `
              PROTOCOL: STRUCTURED COMPLETE COURSE.
              ROLE: Senior Technical Architect & Instructor.
              OBJECTIVE: Teach ${selectedTechs.join(', ')} from ABSOLUTE ZERO to EXPERT.
              STRUCTURE: 
              - Current Lesson: ${courseProgress}/10. 
              - If progress is 0: Start with a clear 10-module roadmap.
              - Each lesson must be deep, clearing all fundamentals before advancing.
              - When a major concept/module is fully taught and understood, end your response with "[MODULE_COMPLETE]".
              - Focus on real-world implementation, architecture, and interview theory.
            `;
          } else if (sessionMode === 'study') {
            modeSpec = `PROTOCOL: STUDY MODE. Pure Doubt Clearing. No testing. In-depth explanations for ${selectedTechs.join(', ')}.`;
          } else if (sessionMode === 'prep') {
            modeSpec = `PROTOCOL: PREP MODE. Mentor focus. Use [Q] for milestones.`;
          } else {
            modeSpec = `PROTOCOL: PANEL MODE. Cold assessment. Strictly milestone questions using [Q].`;
          }

          const prompt = `
            ${modeSpec}
            LANGUAGE: ${languagePreference.toUpperCase()} (Hinglish mix: technical depth in English, conversation in Hindi).
            CACHE_MEMORY: 
            - Previous Mistake Log: ${mistakeLog.join(', ')}
            - Mastery Stage: ${masteryStage}
            - Last Known Progress: Module ${courseProgress}/10
            - Resuming Session: ${isResuming}
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
              setConversationHistory(prev => [...prev, `AI: ${output.replace(/\[Q\]|\[MODULE_COMPLETE\]/g, '')}`, `User: ${input}`].slice(-30));
              
              if (output.includes('[Q]') && (sessionMode === 'prep' || sessionMode === 'interview')) {
                setQuestionCount(c => c + 1);
              }

              if (output.includes('[MODULE_COMPLETE]') && sessionMode === 'course') {
                setCourseProgress(p => Math.min(p + 1, 10));
              }

              if (output.toLowerCase().includes("wrong") || output.toLowerCase().includes("galat")) {
                setMistakeLog(prev => [...prev, `${selectedTechs[0]} Concept Check`].slice(-10));
              }

              if (questionCount >= 40 && output.toLowerCase().includes("pass")) {
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
          You are the 'FuturePrep Neural Core'.
          COURSE MODE: You are a structural teacher. Teach ${selectedTechs.join(', ')} from the ground up.
          STUDY MODE: Clear all technical doubts patiently.
          PREP MODE: Mentor with milestones.
          Always use HINGLISH. Maintain a helpful, senior professional persona.
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

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-[#020617]">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className={`absolute top-0 right-0 w-[800px] h-[800px] bg-${getModeColor()}-500/5 blur-[120px] rounded-full transition-colors duration-1000`}></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-red-500/5 blur-[120px] rounded-full"></div>
      </div>

      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <div className="text-3xl filter drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">🚀</div>
          <div>
            <h1 className="font-header text-xl font-black tracking-tighter text-white uppercase italic">FUTUREPREP</h1>
            <div className="flex items-center space-x-2">
              <span className={`text-[9px] font-bold uppercase tracking-widest text-${getModeColor()}-400`}>Neural Core v7.5</span>
              <span className="w-1 h-1 bg-white/20 rounded-full"></span>
              <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">Secure Link: Online</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-6">
           <div className="hidden md:flex bg-slate-900/80 rounded-full p-1 border border-white/10">
            {['english', 'hinglish'].map(l => (
              <button 
                key={l}
                onClick={() => setLanguagePreference(l as any)}
                className={`px-5 py-2 rounded-full text-[10px] font-black transition-all ${languagePreference === l ? 'bg-white text-slate-900 shadow-xl scale-105' : 'text-slate-500 hover:text-slate-300'}`}
              >{l.toUpperCase()}</button>
            ))}
          </div>
          <button onClick={clearAllData} className="text-[10px] text-slate-600 hover:text-red-500 font-bold transition-colors uppercase tracking-[0.2em]">Reset Brain</button>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 max-w-7xl mx-auto w-full z-10">
        {view === 'dashboard' && (
          <div className="space-y-16 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <section className="text-center space-y-6">
              <h2 className="text-5xl md:text-8xl font-header font-black leading-none text-white italic tracking-tighter">
                {languagePreference === 'hinglish' ? 'KYA MASTER KARNA HAI?' : 'NEURAL HUB'}
              </h2>
              <p className="text-slate-500 font-bold text-sm tracking-widest uppercase italic">Select topic and select protocol</p>
            </section>

            <div className="max-w-3xl mx-auto relative group z-30">
              <div className={`absolute -inset-2 bg-gradient-to-r from-${getModeColor()}-500/20 to-transparent rounded-[40px] blur opacity-50 group-hover:opacity-100 transition duration-1000`}></div>
              <div className="relative glass rounded-[40px] p-3 flex flex-col shadow-2xl">
                <div className="flex items-center">
                  <div className="pl-8 text-3xl">🔍</div>
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Course Topic (VMware, Azure, AWS, VSIF...)"
                    className="w-full bg-transparent p-8 text-2xl focus:outline-none text-white font-black placeholder-slate-700 uppercase italic tracking-tighter"
                  />
                  {isSearching && <div className="pr-8 animate-spin text-cyan-400 text-3xl">⚙️</div>}
                </div>
                {selectedTechs.length > 0 && (
                  <div className="px-8 pb-6 flex flex-wrap gap-3 animate-in fade-in">
                    {selectedTechs.map(tech => (
                      <div key={tech} className={`flex items-center space-x-3 px-6 py-3 rounded-2xl border-2 border-${getModeColor()}-500/30 bg-${getModeColor()}-500/10 text-sm font-black text-white uppercase italic`}>
                        <span>{tech}</span>
                        <button onClick={() => toggleTech(tech)} className="text-slate-400 hover:text-white transition-colors ml-2">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Enhanced Search Suggestions */}
              {hasSearched && (
                <div className="absolute top-full left-0 right-0 mt-4 glass rounded-[35px] overflow-hidden z-50 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.5)] border border-white/10 animate-in slide-in-from-top-4 duration-300">
                  {suggestions.length > 0 ? (
                    suggestions.map((tech, i) => (
                      <button 
                        key={i} 
                        onClick={() => toggleTech(tech)} 
                        className="w-full text-left px-10 py-6 hover:bg-white/10 text-white font-black text-xl transition-all flex items-center justify-between group uppercase italic"
                      >
                        <span>{tech}</span>
                        <span className={`text-${getModeColor()}-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs tracking-widest`}>Sync Intelligence</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-10 py-8 text-slate-500 font-bold uppercase tracking-widest text-center">
                      {isSearching ? 'Searching Neural Database...' : 'No relevant technology found'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedTechs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 animate-in zoom-in-95 duration-500 max-w-6xl mx-auto">
                {/* NEW COURSE MODE CARD */}
                <div 
                  onClick={() => setSessionMode('course')} 
                  className={`group relative p-10 glass rounded-[50px] cursor-pointer border-2 transition-all hover:scale-[1.05] hover:rotate-1 ${sessionMode === 'course' ? 'border-teal-500 bg-teal-500/10 shadow-[0_0_40px_rgba(20,184,166,0.2)]' : 'border-white/5 opacity-50'}`}
                >
                  <div className="text-6xl mb-6 group-hover:scale-110 transition-transform">🎓</div>
                  <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Full Course</h3>
                  <p className="text-slate-400 text-xs mt-3 leading-relaxed font-medium">10-Module structured learning path from scratch to expert mastery. Persistent progress.</p>
                </div>

                <div 
                  onClick={() => setSessionMode('study')} 
                  className={`group relative p-10 glass rounded-[50px] cursor-pointer border-2 transition-all hover:scale-[1.05] hover:-rotate-1 ${sessionMode === 'study' ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.2)]' : 'border-white/5 opacity-50'}`}
                >
                  <div className="text-6xl mb-6 group-hover:rotate-12 transition-transform">📖</div>
                  <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Study Mode</h3>
                  <p className="text-slate-400 text-xs mt-3 leading-relaxed font-medium">Grandmaster Teaching. Clear all doubts. Pure deep-dive knowledge without testing.</p>
                </div>

                <div 
                  onClick={() => setSessionMode('prep')} 
                  className={`group relative p-10 glass rounded-[50px] cursor-pointer border-2 transition-all hover:scale-[1.05] hover:rotate-1 ${sessionMode === 'prep' ? 'border-purple-500 bg-purple-500/10 shadow-[0_0_40px_rgba(139,92,246,0.2)]' : 'border-white/5 opacity-50'}`}
                >
                  <div className="text-6xl mb-6 group-hover:-rotate-6 transition-transform">🛠️</div>
                  <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Mentor Mode</h3>
                  <p className="text-slate-400 text-xs mt-3 leading-relaxed font-medium">Rigor Focus. 40 Milestone challenges with instant feedback and correction.</p>
                </div>

                <div 
                  onClick={() => setSessionMode('interview')} 
                  className={`group relative p-10 glass rounded-[50px] cursor-pointer border-2 transition-all hover:scale-[1.05] hover:-rotate-1 ${sessionMode === 'interview' ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_40px_rgba(6,182,212,0.2)]' : 'border-white/5 opacity-50'}`}
                >
                  <div className="text-6xl mb-6 group-hover:scale-95 transition-transform">💀</div>
                  <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Panel Mode</h3>
                  <p className="text-slate-400 text-xs mt-3 leading-relaxed font-medium">High Stakes. Cold assessment interview simulation. Strictly evaluation only.</p>
                </div>
              </div>
            )}

            {selectedTechs.length > 0 && (
              <div className="flex justify-center pt-10">
                 <button 
                  onClick={() => { setView('session'); startLiveSession(false); }} 
                  className="group relative px-24 py-10 rounded-[50px] bg-white text-slate-900 font-black text-4xl shadow-[0_0_60px_rgba(255,255,255,0.2)] hover:scale-110 active:scale-95 transition-all uppercase italic tracking-tighter overflow-hidden"
                >
                  <span className="relative z-10">INITIALIZE {sessionMode}</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'session' && (
          <div className="h-full flex flex-col items-center justify-center max-w-5xl mx-auto space-y-16 animate-in zoom-in-95 duration-500 relative">
            <div className={`absolute top-0 left-0 scanner bg-${getModeColor()}-500 shadow-[0_0_20px_rgba(255,255,255,0.5)]`}></div>
            
            {/* Extended Status HUD */}
            <div className="absolute top-0 left-0 right-0 flex justify-between items-start px-6 pt-2">
              <div className={`flex flex-col space-y-2`}>
                <div className={`flex items-center space-x-3 px-6 py-3 rounded-full glass border border-${getModeColor()}-500/40 shadow-lg`}>
                  <div className={`w-3 h-3 rounded-full ${isLive ? 'bg-cyan-400 animate-pulse shadow-[0_0_15px_cyan]' : 'bg-red-500'}`} />
                  <span className={`text-xs font-black uppercase tracking-[0.2em] ${isLive ? 'text-cyan-400' : 'text-red-500'}`}>
                    {isLive ? '[ LINK STABLE ]' : '[ LINK BROKEN ]'}
                  </span>
                </div>
                {isLive && (
                   <div className="px-6 py-2 glass rounded-full border border-white/5 inline-block">
                     <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Neural Cache: SYNCED</span>
                   </div>
                )}
              </div>
              <div className="flex flex-col items-end space-y-2">
                <div className="glass px-6 py-3 rounded-2xl border border-white/10 text-right">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block">Neural Pathway</span>
                  <span className="text-sm text-white font-black uppercase italic">{selectedTechs[0]}</span>
                </div>
              </div>
            </div>

            <div className="relative group">
              <div className={`absolute -inset-32 bg-${getModeColor()}-500/10 blur-[150px] rounded-full animate-pulse transition-all duration-1000`} />
              <div className={`relative w-96 h-96 rounded-[100px] border-4 border-${getModeColor()}-500 shadow-[0_0_60px_rgba(var(--color-rgb),0.3)] flex items-center justify-center bg-[#020617] overflow-hidden`}>
                <div className={`transition-all duration-700 ${isLive ? 'scale-110' : 'scale-90 opacity-20 filter grayscale'}`}>
                  <span className="text-[10rem] select-none filter drop-shadow-2xl">
                    {sessionMode === 'course' ? '🎓' : sessionMode === 'study' ? '📖' : avatarGender === 'male' ? '🤖' : '👩‍🚀'}
                  </span>
                </div>
                {/* Reactive Waveform Overlay */}
                {isLive && (
                  <div className="absolute bottom-10 left-0 right-0 flex justify-center space-x-1 h-12">
                    {[1,2,3,4,5,6].map(i => (
                      <div key={i} className={`w-1.5 bg-${getModeColor()}-400 rounded-full animate-pulse`} style={{ height: `${20 + Math.random() * 80}%`, animationDelay: `${i * 0.1}s` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="text-center space-y-8 w-full max-w-xl">
              {sessionMode === 'course' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <div className="text-left">
                      <span className="text-[10px] text-teal-400 font-black uppercase tracking-[0.3em] block mb-1">Module Progression</span>
                      <span className="text-2xl font-header font-black text-white italic">0{courseProgress} <span className="text-xs text-slate-600">/ 10</span></span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-black tracking-widest uppercase">{Math.round((courseProgress / 10) * 100)}% Mastered</span>
                  </div>
                  <div className="w-full h-4 bg-slate-900 rounded-full border border-white/5 overflow-hidden p-1 shadow-inner">
                    <div 
                      className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-1000 relative" 
                      style={{ width: `${(courseProgress / 10) * 100}%` }} 
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                </div>
              ) : sessionMode !== 'study' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <div className="text-left">
                      <span className="text-[10px] text-purple-400 font-black uppercase tracking-[0.3em] block mb-1">Rigor Milestones</span>
                      <span className="text-2xl font-header font-black text-white italic">{questionCount} <span className="text-xs text-slate-600">/ 40</span></span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-black tracking-widest uppercase">{Math.round((questionCount / 40) * 100)}% Sync</span>
                  </div>
                  <div className="w-full h-4 bg-slate-900 rounded-full border border-white/5 overflow-hidden p-1 shadow-inner">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${(questionCount / 40) * 100}%` }} 
                    />
                  </div>
                </div>
              ) : (
                <div className="py-4 px-12 glass border-2 border-emerald-500/30 rounded-full inline-block shadow-2xl">
                  <span className="text-emerald-400 font-black text-xs uppercase tracking-[0.6em] animate-pulse">Neural Knowledge Stream Active</span>
                </div>
              )}
              <h2 className="text-4xl font-header font-black text-white italic tracking-tighter uppercase">
                {sessionMode} PROTOCOL
              </h2>
            </div>

            <div className="flex flex-col items-center space-y-8 w-full">
              {!isLive ? (
                <button 
                  onClick={() => startLiveSession(true)} 
                  className="px-28 py-10 rounded-[50px] bg-white text-slate-950 font-black text-4xl shadow-2xl hover:scale-110 active:scale-95 transition-all uppercase italic tracking-tighter"
                >
                  RE-CONNECT NEURAL LINK
                </button>
              ) : (
                <div className="flex flex-col items-center space-y-6">
                  <button 
                    onClick={stopSession} 
                    className="px-24 py-10 rounded-[50px] bg-red-600 text-white font-black text-4xl shadow-[0_0_40px_rgba(220,38,38,0.4)] hover:bg-red-700 hover:scale-105 active:scale-95 transition-all uppercase italic tracking-tighter"
                  >
                    DISCONNECT LINK
                  </button>
                  <p className="text-[10px] text-slate-600 font-bold tracking-[0.5em] uppercase animate-pulse">Knowledge Syncing In Progress...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'feedback' && (
          <div className="max-w-5xl mx-auto space-y-16 py-16 animate-in slide-in-from-bottom-12 duration-1000">
             <div className="text-center space-y-6">
                <div className={`inline-block px-10 py-4 rounded-full bg-${getModeColor()}-500/10 text-${getModeColor()}-400 border-${getModeColor()}-500/20 text-xs font-black tracking-[0.4em] border-2 uppercase italic shadow-2xl`}>Sync Transmission Summary</div>
                <h2 className="text-8xl font-header font-black text-white italic tracking-tighter uppercase">KNOWLEDGE CACHED</h2>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className={`glass p-16 rounded-[60px] text-center border-b-[12px] border-${getModeColor()}-500 transition-all hover:scale-110 hover:-rotate-1`}>
                  <div className="text-8xl font-header font-black mb-4 text-white">
                    {sessionMode === 'course' ? courseProgress : (sessionMode === 'study' ? '∞' : questionCount)}
                  </div>
                  <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase">
                    {sessionMode === 'course' ? 'Modules Completed' : 'Rigor Milestones'}
                  </div>
                </div>
                <div className="glass p-16 rounded-[60px] text-center border-b-[12px] border-red-500 transition-all hover:scale-110 hover:rotate-1">
                  <div className="text-8xl font-header font-black mb-4 text-white">{mistakeLog.length}</div>
                  <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase">Topics to Review</div>
                </div>
                <div className={`glass p-16 rounded-[60px] text-center border-b-[12px] border-white transition-all hover:scale-110 hover:-rotate-1`}>
                  <div className="text-8xl font-header font-black mb-4 text-white">{masteryStage}</div>
                  <div className="text-[10px] text-slate-500 font-black tracking-widest uppercase">Neural Stage Rank</div>
                </div>
             </div>

             <div className="glass p-12 rounded-[60px] border border-white/5 space-y-8 shadow-2xl">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.4em]">Active Knowledge Gaps</h4>
                  <div className={`px-4 py-2 rounded-full bg-${getModeColor()}-500/10 border border-${getModeColor()}-500/30 text-[9px] font-black text-${getModeColor()}-400 tracking-widest uppercase`}>Cached Memory</div>
                </div>
                <div className="flex flex-wrap gap-4">
                  {selectedTechs.map(t => (
                    <span key={t} className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm font-black text-white uppercase italic tracking-tight">{t}</span>
                  ))}
                  {mistakeLog.length === 0 && <span className="text-slate-700 font-bold uppercase tracking-widest italic">No gaps detected. Excellent performance.</span>}
                  {mistakeLog.slice(-5).map((m, i) => (
                    <span key={i} className="px-6 py-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-sm font-black text-red-400 uppercase italic tracking-tight">{m}</span>
                  ))}
                </div>
             </div>

             <button 
              onClick={() => { setView('dashboard'); setSearchTerm(''); }} 
              className="w-full py-12 rounded-[60px] bg-white text-slate-950 font-black text-4xl hover:bg-slate-200 active:scale-95 transition-all shadow-[0_20px_50px_rgba(0,0,0,0.5)] uppercase italic tracking-tighter"
             >
                RETURN TO NEURAL HUB
             </button>
          </div>
        )}
      </main>

      <footer className="p-12 text-center text-slate-900 text-[10px] tracking-[1.2em] font-mono uppercase opacity-40">
        FuturePrep AI // RIGOR: v7.5 // CACHE: {isLive ? 'ACTIVE' : 'READY'} // PROTOCOL: {sessionMode.toUpperCase()}
      </footer>
    </div>
  );
};

export default App;
