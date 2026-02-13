import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    ActivityConfig,
    ResourceData,
    ActivityType,
    cn
} from '@/shared';

// === 1. 공통 인터페이스 정의 ===
// 모든 액티비티 컴포넌트는 이 Props를 따릅니다.
export interface ActivityProps {
    config: ActivityConfig;
    data: ResourceData[];
    onComplete: (score: number) => void;
    onError?: (message: string) => void;
}

// Global Audio Utility
const audioPlayer = new Audio();
const playAudio = (url: string | undefined) => {
    if (!url) return;
    try {
        audioPlayer.pause();
        audioPlayer.src = url;
        audioPlayer.play().catch(err => console.error("Audio Play Error:", err));
    } catch (err) {
        console.error("Audio Play Error:", err);
    }
};

// === 2. 개별 액티비티 컴포넌트 (Placeholder) ===
// 실제 개발 시 별도 파일로 분리 예정 (e.g., /activities/QuizMultiple.tsx)

const QuizMultiple: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);

    // 문제 데이터 생성 (정답 + 오답 섞기)
    const questions = useMemo(() => {
        // 전체 데이터를 섞어서 문제 순서 결정
        const shuffledData = [...data].sort(() => Math.random() - 0.5);

        return shuffledData.map((targetItem) => {
            // 현재 정답을 제외한 나머지 데이터에서 오답(Distractors) 2개 추출
            const distractors = data
                .filter((item) => item.id !== targetItem.id)
                .sort(() => Math.random() - 0.5)
                .slice(0, 2);

            // 정답과 오답을 합치고 다시 섞기
            const choices = [targetItem, ...distractors].sort(() => Math.random() - 0.5);

            return {
                target: targetItem,
                choices: choices
            };
        });
    }, [data]);

    const currentQuestion = questions[currentIndex];

    const handleAnswer = (choiceId: string) => {
        if (isAnswered) return;

        setIsAnswered(true);
        setSelectedId(choiceId);

        const isCorrect = choiceId === currentQuestion.target.id;
        if (isCorrect) {
            setScore((prev) => prev + 1);
        }

        // 1.5초 후 다음 문제로 이동
        setTimeout(() => {
            if (currentIndex < questions.length - 1) {
                setCurrentIndex((prev) => prev + 1);
                setSelectedId(null);
                setIsAnswered(false);
            } else {
                // 퀴즈 종료
                const finalScore = isCorrect ? score + 1 : score;
                const normalizedScore = Math.round((finalScore / questions.length) * 100);
                onComplete(normalizedScore);
            }
        }, 1500);
    };

    if (!currentQuestion) return null;

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto p-6 animate-fade-in">
            {/* 진행 상황 표시 */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex gap-1">
                    {questions.map((_, idx) => (
                        <div
                            key={idx}
                            className={cn(
                                "w-2 h-2 rounded-full transition-all",
                                idx === currentIndex ? "bg-indigo-600 w-6" :
                                    idx < currentIndex ? "bg-indigo-200" : "bg-slate-200"
                            )}
                        />
                    ))}
                </div>
                <div className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                    Score: {score}
                </div>
            </div>

            {/* 문제 영역 */}
            <div className="flex-1 flex flex-col items-center justify-center mb-10">
                <div
                    className={cn(
                        "text-center space-y-4",
                        currentQuestion.target.audioUrl && "cursor-pointer active:scale-[0.98] transition-all"
                    )}
                    onClick={() => playAudio(currentQuestion.target.audioUrl)}
                >
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                        Question {currentIndex + 1}
                        {currentQuestion.target.audioUrl && <i className="fas fa-volume-up text-[10px] text-indigo-400"></i>}
                    </span>
                    <h2 className="text-4xl font-black text-slate-800 leading-tight">
                        {currentQuestion.target.text}
                    </h2>
                    {currentQuestion.target.subText && (
                        <p className="text-xl text-slate-500 font-serif italic">
                            {currentQuestion.target.subText}
                        </p>
                    )}
                </div>
            </div>

            {/* 선택지 영역 */}
            <div className="grid gap-3">
                {currentQuestion.choices.map((choice) => {
                    const isSelected = selectedId === choice.id;
                    const isTarget = choice.id === currentQuestion.target.id;

                    let buttonStyle = "bg-white border-2 border-slate-100 text-slate-600 hover:border-indigo-200 hover:bg-indigo-50";
                    let icon = null;

                    if (isAnswered) {
                        if (isTarget) {
                            buttonStyle = "bg-emerald-100 border-emerald-400 text-emerald-700 shadow-emerald-100";
                            icon = <i className="fas fa-check text-emerald-600"></i>;
                        } else if (isSelected && !isTarget) {
                            buttonStyle = "bg-rose-100 border-rose-400 text-rose-700 shadow-rose-100";
                            icon = <i className="fas fa-times text-rose-600"></i>;
                        } else {
                            buttonStyle = "bg-slate-50 border-slate-100 text-slate-400 opacity-50";
                        }
                    }

                    return (
                        <button
                            key={choice.id}
                            onClick={() => handleAnswer(choice.id)}
                            disabled={isAnswered}
                            className={cn(
                                "w-full p-5 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-between shadow-sm hover:shadow-md active:scale-[0.98]",
                                buttonStyle
                            )}
                        >
                            <span>{choice.translation}</span>
                            {icon}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const QuizFillBlank: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [score, setScore] = useState(0);
    const [userAnswer, setUserAnswer] = useState<string | null>(null);
    const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

    const questions = useMemo(() => {
        const sentences = data.filter(d => d.dataUnit === 'sentence');
        const words = data.filter(d => d.dataUnit === 'word');
        const targetSentences = sentences.length > 0 ? sentences : data;

        return targetSentences.map(sentence => {
            let targetWord = '';
            const matchedWord = words.find(w => sentence.text.includes(w.text));

            if (matchedWord) {
                targetWord = matchedWord.text;
            } else {
                const split = sentence.text.split(/\s+/);
                const candidates = split.filter(w => w.length >= 2);
                if (candidates.length > 0) {
                    targetWord = candidates.sort((a, b) => b.length - a.length)[0];
                } else {
                    targetWord = split[0] || '';
                }
            }

            const parts: (string | { isBlank: true })[] = [];
            const idx = sentence.text.indexOf(targetWord);

            if (idx !== -1 && targetWord) {
                parts.push(sentence.text.substring(0, idx));
                parts.push({ isBlank: true });
                parts.push(sentence.text.substring(idx + targetWord.length));
            } else {
                parts.push(sentence.text);
            }

            const otherWords = words.filter(w => w.text !== targetWord).map(w => w.text);
            const otherSentenceWords = data
                .filter(d => d.id !== sentence.id)
                .map(d => d.text.split(' ')[0])
                .filter(w => w !== targetWord);

            const pool = Array.from(new Set([...otherWords, ...otherSentenceWords]));
            const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 3);

            while (distractors.length < 3) {
                distractors.push(['Apple', 'Banana', 'School', 'Teacher'][distractors.length]);
            }

            const options = [targetWord, ...distractors].sort(() => Math.random() - 0.5);

            return {
                id: sentence.id,
                fullText: sentence.text,
                translation: sentence.translation,
                parts,
                targetWord,
                options
            };
        }).filter(q => q.targetWord);
    }, [data]);

    const currentQuestion = questions[currentIndex];

    const handleSelect = (answer: string) => {
        if (userAnswer) return;

        setUserAnswer(answer);
        const correct = answer === currentQuestion.targetWord;
        setIsCorrect(correct);

        if (correct) setScore(s => s + 1);

        setTimeout(() => {
            if (currentIndex < questions.length - 1) {
                setCurrentIndex(prev => prev + 1);
                setUserAnswer(null);
                setIsCorrect(null);
            } else {
                const finalScore = correct ? score + 1 : score;
                onComplete(Math.round((finalScore / questions.length) * 100));
            }
        }, 1500);
    };

    if (!currentQuestion) return null;

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto p-6 animate-fade-in">
            <div className="w-full h-2 bg-slate-100 rounded-full mb-8 overflow-hidden">
                <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
                />
            </div>

            <div className="flex-1 flex flex-col items-center justify-center mb-10">
                <div
                    className={cn(
                        "text-center space-y-6 max-w-xl",
                        data.find(d => d.id === currentQuestion.id)?.audioUrl && "cursor-pointer active:scale-[0.98] transition-all"
                    )}
                    onClick={() => {
                        const audioUrl = data.find(d => d.id === currentQuestion.id)?.audioUrl;
                        playAudio(audioUrl);
                    }}
                >
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                        Fill in the blank
                        {data.find(d => d.id === currentQuestion.id)?.audioUrl && <i className="fas fa-volume-up text-[10px] text-indigo-400"></i>}
                    </span>

                    <div className="text-3xl sm:text-4xl font-black text-slate-800 leading-relaxed break-keep">
                        {currentQuestion.parts.map((part, i) => (
                            typeof part === 'string' ? (
                                <span key={i}>{part}</span>
                            ) : (
                                <span key={i} className={cn(
                                    "inline-block min-w-[100px] border-b-4 mx-2 px-2 text-center transition-colors",
                                    userAnswer
                                        ? (isCorrect ? "border-emerald-400 text-emerald-600 bg-emerald-50" : "border-rose-400 text-rose-600 bg-rose-50")
                                        : "border-indigo-200 bg-indigo-50/50 text-transparent"
                                )}>
                                    {userAnswer || "____"}
                                </span>
                            )
                        ))}
                    </div>

                    <p className="text-lg text-slate-500 font-serif italic">
                        {currentQuestion.translation}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {currentQuestion.options.map((option, idx) => {
                    const isSelected = userAnswer === option;
                    const isTarget = option === currentQuestion.targetWord;

                    let btnClass = "bg-white border-2 border-slate-100 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:-translate-y-1";

                    if (userAnswer) {
                        if (isTarget) btnClass = "bg-emerald-500 border-emerald-500 text-white shadow-emerald-200";
                        else if (isSelected && !isTarget) btnClass = "bg-rose-500 border-rose-500 text-white shadow-rose-200";
                        else btnClass = "bg-slate-50 border-slate-100 text-slate-300 opacity-50";
                    }

                    return (
                        <button
                            key={idx}
                            onClick={() => handleSelect(option)}
                            disabled={!!userAnswer}
                            className={cn(
                                "p-4 rounded-xl font-bold text-lg transition-all duration-300 shadow-sm",
                                btnClass
                            )}
                        >
                            {option}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const Flashcard: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    const currentItem = data[currentIndex];

    useEffect(() => {
        setIsFlipped(false);
    }, [currentIndex]);

    const handleNext = () => {
        if (currentIndex < data.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            onComplete(100);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
        }
    };

    const handlePlayAudio = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        playAudio(currentItem.audioUrl);
    };

    if (!currentItem) return null;

    return (
        <div className="flex flex-col items-center justify-center h-full w-full p-4 animate-fade-in">
            <div className="w-full max-w-md mb-6 flex items-center gap-3">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${((currentIndex + 1) / data.length) * 100}%` }}
                    />
                </div>
                <span className="text-xs font-bold text-slate-400">
                    {currentIndex + 1} / {data.length}
                </span>
            </div>

            <div
                className="relative w-full max-w-md aspect-[4/5] sm:aspect-[3/2] cursor-pointer group [perspective:1000px]"
                onClick={() => setIsFlipped(!isFlipped)}
            >
                <div className={cn(
                    "w-full h-full transition-all duration-500 [transform-style:preserve-3d] shadow-2xl rounded-3xl",
                    isFlipped ? "[transform:rotateY(180deg)]" : ""
                )}>
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] bg-white rounded-3xl border-2 border-slate-100 flex flex-col items-center justify-center p-8 text-center">
                        <span className="absolute top-6 left-6 text-xs font-black text-slate-300 uppercase tracking-widest">Front</span>
                        {currentItem.imageUrl ? (
                            <div className="w-full flex-1 mb-4 rounded-xl overflow-hidden relative">
                                <img src={currentItem.imageUrl} alt="Front" className="absolute inset-0 w-full h-full object-contain" />
                            </div>
                        ) : (
                            <div
                                className={cn("flex-1 flex items-center justify-center", currentItem.audioUrl && "cursor-pointer active:scale-95 transition-all")}
                                onClick={handlePlayAudio}
                            >
                                <h3 className="text-3xl sm:text-4xl font-black text-slate-800 break-keep leading-tight">
                                    {currentItem.text}
                                    {currentItem.audioUrl && <i className="fas fa-volume-up text-indigo-400 text-lg ml-3"></i>}
                                </h3>
                            </div>
                        )}
                        {currentItem.imageUrl && <h3 className="text-xl font-bold text-slate-800 mb-2">{currentItem.text}</h3>}
                        {currentItem.audioUrl && (
                            <button onClick={(e) => { e.stopPropagation(); playAudio(currentItem.audioUrl); }} className="mt-4 w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-100 hover:scale-110 transition-all shadow-sm">
                                <i className="fas fa-volume-up"></i>
                            </button>
                        )}
                    </div>
                    <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl flex flex-col items-center justify-center p-8 text-center text-white">
                        <span className="absolute top-6 left-6 text-xs font-black text-white/40 uppercase tracking-widest">Back</span>
                        <div className="flex-1 flex flex-col items-center justify-center gap-4">
                            {currentItem.subText && <p className="text-lg text-indigo-200 font-medium">{currentItem.subText}</p>}
                            <h3 className="text-2xl sm:text-3xl font-black break-keep leading-tight">{currentItem.translation}</h3>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-4 mt-8">
                <button onClick={handlePrev} disabled={currentIndex === 0} className="w-12 h-12 rounded-full bg-white border border-slate-200 text-slate-400 flex items-center justify-center hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                    <i className="fas fa-arrow-left"></i>
                </button>
                <button onClick={handleNext} className="px-8 py-3 rounded-full bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-lg shadow-slate-200">
                    {currentIndex === data.length - 1 ? '완료하기' : '다음 카드'}
                </button>
            </div>
        </div>
    );
};

const VoiceRecognition: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [textToSpeak, setTextToSpeak] = useState('');
    const [recognizedText, setRecognizedText] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [accuracy, setAccuracy] = useState<number | null>(null);
    const recognitionRef = useRef<any>(null);

    useEffect(() => {
        if (data && data.length > 0) {
            // Use the first data item's text as the text to speak
            setTextToSpeak(data[0].text);
        }

        // Initialize Web Speech API
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.lang = 'ko-KR'; // Korean by default, can be adjusted

            recognitionRef.current.onstart = () => {
                setIsListening(true);
                setRecognizedText('');
                setAccuracy(null);
            };

            recognitionRef.current.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                setRecognizedText(transcript);
                calculateAccuracy(transcript, textToSpeak);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error('Speech recognition error:', event.error);
                setIsListening(false);
            };
        } else {
            console.warn('Web Speech API is not supported in this browser.');
        }

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [data]);

    const startRecognition = () => {
        if (recognitionRef.current) {
            recognitionRef.current.start();
        }
    };

    const calculateAccuracy = (recognized: string, original: string) => {
        // Simple accuracy calculation (can be enhanced with NLP techniques)
        const wordsRecognized = recognized.split(' ');
        const wordsOriginal = original.split(' ');
        let correctWords = 0;

        for (let i = 0; i < Math.min(wordsRecognized.length, wordsOriginal.length); i++) {
            if (wordsRecognized[i].toLowerCase() === wordsOriginal[i].toLowerCase()) {
                correctWords++;
            }
        }

        const calculatedAccuracy = Math.round((correctWords / wordsOriginal.length) * 100);
        setAccuracy(calculatedAccuracy);
        onComplete(calculatedAccuracy); // Report accuracy
    };

    return (
        <div className="flex flex-col items-center justify-center h-full p-4 animate-fade-in">
            <h3 className="text-xl font-bold mb-4">음성 인식</h3>
            <p className="text-slate-500">따라하세요:</p>
            <div
                className={cn(
                    "relative group",
                    (data[0]?.audioUrl) && "cursor-pointer active:scale-95 transition-all"
                )}
                onClick={() => playAudio(data[0]?.audioUrl)}
            >
                <p className="text-2xl font-bold mb-4 flex items-center gap-3">
                    {textToSpeak}
                    {data[0]?.audioUrl && <i className="fas fa-volume-up text-indigo-400"></i>}
                </p>
            </div>

            <button
                onClick={startRecognition}
                disabled={isListening}
                className="px-4 py-2 rounded-full bg-indigo-500 text-white font-bold disabled:bg-slate-300"
            >
                {isListening ? 'Listening...' : 'Start Recognition'}
            </button>

            {recognizedText && (
                <div className="mt-4">
                    <p>Recognized: {recognizedText}</p>
                    {accuracy !== null && <p>Accuracy: {accuracy}%</p>}
                </div>
            )}
        </div>
    );
};

const MemoryGame: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [cards, setCards] = useState<any[]>([]);
    const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [attempts, setAttempts] = useState(0);
    const [matchedCount, setMatchedCount] = useState(0);

    useEffect(() => {
        if (!data || data.length === 0) return;
        const generatedCards = data.flatMap((item) => {
            const cardA = { id: `${item.id}-A`, pairId: item.id, content: item.text, subText: item.subText, imageUrl: item.imageUrl, audioUrl: item.audioUrl, type: 'source', isFlipped: false, isMatched: false };
            const cardB = { id: `${item.id}-B`, pairId: item.id, content: item.translation, type: 'target', isFlipped: false, isMatched: false };
            return [cardA, cardB];
        });
        setCards(generatedCards.sort(() => Math.random() - 0.5));
        setFlippedIndices([]);
        setMatchedCount(0);
        setAttempts(0);
    }, [data]);

    const handleCardClick = (index: number) => {
        if (isProcessing || cards[index].isFlipped || cards[index].isMatched) return;
        if (cards[index].audioUrl) playAudio(cards[index].audioUrl);

        const newCards = [...cards];
        newCards[index].isFlipped = true;
        setCards(newCards);
        const newFlipped = [...flippedIndices, index];
        setFlippedIndices(newFlipped);

        if (newFlipped.length === 2) {
            setIsProcessing(true);
            setAttempts(prev => prev + 1);
            const [idx1, idx2] = newFlipped;
            if (newCards[idx1].pairId === newCards[idx2].pairId) {
                setTimeout(() => {
                    setCards(prev => prev.map((c, i) => i === idx1 || i === idx2 ? { ...c, isMatched: true } : c));
                    setFlippedIndices([]);
                    setIsProcessing(false);
                    setMatchedCount(prev => {
                        const newCount = prev + 1;
                        if (newCount === data.length) onComplete(100);
                        return newCount;
                    });
                }, 500);
            } else {
                setTimeout(() => {
                    setCards(prev => prev.map((c, i) => i === idx1 || i === idx2 ? { ...c, isFlipped: false } : c));
                    setFlippedIndices([]);
                    setIsProcessing(false);
                }, 1000);
            }
        }
    };

    if (!cards.length) return null;

    return (
        <div className="flex flex-col h-full animate-fade-in p-4">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <div className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold">Attempts: {attempts}</div>
                    <div className="px-4 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-xs font-bold">Pairs: {matchedCount} / {data.length}</div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 pb-4">
                    {cards.map((card, idx) => (
                        <div key={card.id} onClick={() => handleCardClick(idx)} className={cn("aspect-[3/4] relative cursor-pointer group [perspective:1000px]", (card.isFlipped || card.isMatched) ? "pointer-events-none" : "")}>
                            <div className={cn("w-full h-full transition-all duration-500 [transform-style:preserve-3d] rounded-xl shadow-sm", (card.isFlipped || card.isMatched) ? "[transform:rotateY(180deg)]" : "")}>
                                <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center border-2 border-white/20 shadow-inner"><i className="fas fa-question text-white/30 text-2xl"></i></div>
                                <div className={cn("absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] bg-white rounded-xl border-2 flex flex-col items-center justify-center p-2 text-center shadow-md overflow-hidden", card.isMatched ? "border-emerald-400 bg-emerald-50" : "border-indigo-100")}>
                                    {card.imageUrl ? <img src={card.imageUrl} alt="card" className="w-full h-full object-cover rounded-lg" /> : <div className="flex flex-col items-center justify-center h-full w-full"><span className={cn("font-bold break-keep leading-tight", card.content.length > 10 ? "text-xs" : "text-sm sm:text-base")}>{card.content}</span>{card.audioUrl && <i className="fas fa-volume-up text-indigo-400 text-xs mt-2"></i>}</div>}
                                    {card.isMatched && <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 backdrop-blur-[1px]"><i className="fas fa-check text-emerald-600 text-3xl drop-shadow-md animate-bounce"></i></div>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const DragDrop: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [targets, setTargets] = useState<ResourceData[]>([]);
    const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    useEffect(() => {
        if (data) {
            setTargets([...data].sort(() => Math.random() - 0.5));
        }
    }, [data]);

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault();
        if (matchedIds.has(id)) return;
        setDragOverId(id);
    };

    const handleDragLeave = () => {
        setDragOverId(null);
    };

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        setDragOverId(null);
        const sourceId = e.dataTransfer.getData('text/plain');

        if (sourceId === targetId) {
            const newMatched = new Set(matchedIds);
            newMatched.add(targetId);
            setMatchedIds(newMatched);

            if (newMatched.size === data.length) {
                onComplete(100);
            }
        }
    };

    const playAudio = (url: string) => {
        new Audio(url).play().catch(() => { });
    };

    return (
        <div className="flex flex-col h-full p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800">드래그 앤 드롭 매칭</h3>
                <div className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold">
                    {matchedIds.size} / {data.length} 완료
                </div>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-8 min-h-0">
                {/* Source List (Left) */}
                <div className="space-y-3 overflow-y-auto pr-2">
                    {data.map((item) => {
                        const isMatched = matchedIds.has(item.id);
                        return (
                            <div
                                key={item.id}
                                draggable={!isMatched}
                                onDragStart={(e) => handleDragStart(e, item.id)}
                                className={cn(
                                    "p-4 rounded-xl border-2 bg-white transition-all duration-300 flex items-center gap-3 select-none",
                                    isMatched
                                        ? "opacity-40 border-slate-100 grayscale cursor-default"
                                        : "border-indigo-100 hover:border-indigo-300 hover:shadow-md cursor-grab active:cursor-grabbing"
                                )}
                            >
                                {item.imageUrl ? (
                                    <img src={item.imageUrl} alt="source" className="w-12 h-12 object-cover rounded-lg bg-slate-100" />
                                ) : (
                                    <div className="w-12 h-12 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-lg shrink-0">
                                        {item.text.charAt(0)}
                                    </div>
                                )}

                                <div
                                    className={cn(
                                        "flex-1 min-w-0 text-left",
                                        item.audioUrl && "cursor-pointer hover:text-indigo-600 transition-colors"
                                    )}
                                    onClick={(e) => {
                                        if (item.audioUrl) {
                                            e.stopPropagation();
                                            playAudio(item.audioUrl);
                                        }
                                    }}
                                >
                                    <p className="font-bold text-slate-700 truncate">{item.text}</p>
                                    {item.subText && <p className="text-xs text-slate-400 truncate">{item.subText}</p>}
                                </div>

                                {item.audioUrl && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); playAudio(item.audioUrl!); }}
                                        className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600 flex items-center justify-center transition-colors shrink-0"
                                    >
                                        <i className="fas fa-volume-up text-xs"></i>
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Target List (Right) */}
                <div className="space-y-3 overflow-y-auto pr-2">
                    {targets.map((item) => {
                        const isMatched = matchedIds.has(item.id);
                        const isOver = dragOverId === item.id;

                        return (
                            <div
                                key={item.id}
                                onDragOver={(e) => handleDragOver(e, item.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, item.id)}
                                className={cn(
                                    "p-4 rounded-xl border-2 transition-all duration-300 flex items-center justify-center text-center min-h-[80px] select-none",
                                    isMatched
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                        : isOver
                                            ? "bg-indigo-50 border-indigo-400 scale-[1.02] shadow-lg"
                                            : "bg-slate-50 border-slate-200 border-dashed text-slate-500"
                                )}
                            >
                                {isMatched ? (
                                    <div className="flex items-center gap-2">
                                        <i className="fas fa-check-circle"></i>
                                        <span className="font-bold">{item.translation}</span>
                                    </div>
                                ) : (
                                    <span className="font-medium">{item.translation}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const LineMatching: React.FC<ActivityProps> = ({ data, onComplete }) => {
    const [rightItems, setRightItems] = useState<ResourceData[]>([]);
    const [lines, setLines] = useState<{ startId: string; endId: string; color: string }[]>([]);
    const [drawingLine, setDrawingLine] = useState<{ startId: string; x1: number; y1: number; x2: number; y2: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pointRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [, setUpdateTrigger] = useState(0);

    useEffect(() => {
        if (data) setRightItems([...data].sort(() => Math.random() - 0.5));
        const handleResize = () => setUpdateTrigger(prev => prev + 1);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [data]);

    const getCoords = (key: string) => {
        const el = pointRefs.current[key];
        const container = containerRef.current;
        if (!el || !container) return { x: 0, y: 0 };
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return { x: elRect.left - containerRect.left + elRect.width / 2, y: elRect.top - containerRect.top + elRect.height / 2 };
    };

    const handleStart = (id: string) => {
        if (lines.some(l => l.startId === id)) return;
        const coords = getCoords(`left-${id}`);
        setDrawingLine({ startId: id, x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y });
    };

    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawingLine || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
        setDrawingLine(prev => prev ? { ...prev, x2: clientX - containerRect.left, y2: clientY - containerRect.top } : null);
    };

    const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawingLine) return;
        const clientX = 'changedTouches' in e ? (e as React.TouchEvent).changedTouches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'changedTouches' in e ? (e as React.TouchEvent).changedTouches[0].clientY : (e as React.MouseEvent).clientY;
        const element = document.elementFromPoint(clientX, clientY);
        if (element) {
            const targetDot = element.closest('[data-target-id]');
            if (targetDot) {
                const targetId = targetDot.getAttribute('data-target-id');
                if (targetId && targetId === drawingLine.startId) {
                    setLines(prev => {
                        const newLines = [...prev, { startId: targetId, endId: targetId, color: '#10B981' }];
                        if (newLines.length === data.length) setTimeout(() => onComplete(100), 500);
                        return newLines;
                    });
                }
            }
        }
        setDrawingLine(null);
    };

    return (
        <div ref={containerRef} className="relative flex flex-col h-full p-6 animate-fade-in select-none touch-none" onMouseMove={handleMove} onTouchMove={handleMove} onMouseUp={handleEnd} onTouchEnd={handleEnd}>
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800">선긋기 매칭</h3>
                <div className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold">{lines.length} / {data.length} 완료</div>
            </div>
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                {lines.map(line => {
                    const start = getCoords(`left-${line.startId}`);
                    const end = getCoords(`right-${line.endId}`);
                    return <line key={line.startId} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={line.color} strokeWidth="4" strokeLinecap="round" />;
                })}
                {drawingLine && <line x1={drawingLine.x1} y1={drawingLine.y1} x2={drawingLine.x2} y2={drawingLine.y2} stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeDasharray="8 4" className="animate-pulse" />}
            </svg>
            <div className="flex-1 flex justify-between gap-8 relative z-20">
                <div className="flex-1 flex flex-col justify-around space-y-4">
                    {data.map(item => {
                        const isMatched = lines.some(l => l.startId === item.id);
                        return (
                            <div key={item.id} className="flex items-center">
                                <div
                                    className={cn(
                                        "flex-1 p-4 rounded-xl border-2 bg-white flex items-center gap-3 transition-all",
                                        isMatched ? "border-emerald-200 bg-emerald-50 opacity-60" : "border-indigo-100 shadow-sm",
                                        item.audioUrl && "cursor-pointer active:scale-[0.98]"
                                    )}
                                    onClick={() => playAudio(item.audioUrl)}
                                >
                                    {item.imageUrl ? (
                                        <img src={item.imageUrl} alt="" className="w-12 h-12 object-cover rounded-lg bg-slate-100" />
                                    ) : (
                                        <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold shrink-0">
                                            {item.text.charAt(0)}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-700 truncate text-sm">
                                            {item.text}
                                            {item.audioUrl && <i className="fas fa-volume-up text-[10px] text-indigo-400 ml-2"></i>}
                                        </p>
                                    </div>
                                </div>
                                <div ref={el => pointRefs.current[`left-${item.id}`] = el} onMouseDown={() => handleStart(item.id)} onTouchStart={() => handleStart(item.id)} className={cn("w-6 h-6 rounded-full border-4 ml-[-12px] z-30 cursor-pointer transition-transform hover:scale-125", isMatched ? "bg-emerald-500 border-white" : "bg-indigo-500 border-white shadow-md")} />
                            </div>
                        );
                    })}
                </div>
                <div className="flex-1 flex flex-col justify-around space-y-4">
                    {rightItems.map(item => {
                        const isMatched = lines.some(l => l.endId === item.id);
                        return (
                            <div key={item.id} className="flex items-center flex-row-reverse">
                                <div className={cn("flex-1 p-4 rounded-xl border-2 bg-white flex items-center justify-center text-center transition-all", isMatched ? "border-emerald-200 bg-emerald-50 opacity-60" : "border-slate-200 border-dashed")}><span className="font-bold text-slate-600 text-sm">{item.translation}</span></div>
                                <div ref={el => pointRefs.current[`right-${item.id}`] = el} data-target-id={item.id} className={cn("w-6 h-6 rounded-full border-4 mr-[-12px] z-30 transition-transform", isMatched ? "bg-emerald-500 border-white" : "bg-slate-300 border-white")} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const DefaultActivity: React.FC<ActivityProps> = ({ config }) => (
    <div className="text-center p-10 text-slate-400">
        <i className="fas fa-tools text-4xl mb-4"></i>
        <p>아직 구현되지 않은 액티비티 타입입니다: {config.type}</p>
    </div>
);

// === 3. 액티비티 팩토리 (Renderer) ===
interface ActivityRendererProps {
    activityType: ActivityType;
    config: ActivityConfig;
    data: ResourceData[];
    onComplete?: (score: number) => void;
}

export const ActivityRenderer: React.FC<ActivityRendererProps> = ({
    activityType,
    config,
    data,
    onComplete = () => { }
}) => {
    // 데이터 유효성 검사
    if (!data || data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-slate-400">
                <i className="fas fa-exclamation-circle text-3xl mb-2"></i>
                <p>학습 데이터가 없습니다.</p>
            </div>
        );
    }

    // 타입에 따른 컴포넌트 매핑
    switch (activityType) {
        case 'quiz_multiple':
            return <QuizMultiple config={config} data={data} onComplete={onComplete} />;

        case 'quiz_fill_blank':
            return <QuizFillBlank config={config} data={data} onComplete={onComplete} />;

        case 'voice_recognition':
            return <VoiceRecognition config={config} data={data} onComplete={onComplete} />;

        case 'flashcard':
            return <Flashcard config={config} data={data} onComplete={onComplete} />;

        case 'matching_game': // 메모리 게임으로 매핑
            return <MemoryGame config={config} data={data} onComplete={onComplete} />;

        case 'drag_drop':
            return <DragDrop config={config} data={data} onComplete={onComplete} />;

        case 'line_matching':
            return <LineMatching config={config} data={data} onComplete={onComplete} />;


        default:
            return <DefaultActivity config={config} data={data} onComplete={onComplete} />;
    }
};
