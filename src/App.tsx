import { useState, useRef, useEffect } from 'react';
import './App.css';
import AgoraRTC, { IAgoraRTCRemoteUser, IMicrophoneAudioTrack, NetworkQuality } from 'agora-rtc-sdk-ng';
import { UID } from 'agora-rtc-sdk-ng/esm';
import { Session, ApiService, Language, Voice, Avatar, Credentials } from './apiService';
import NetworkQualityDisplay, { NetworkStats } from './components/NetworkQuality';
import {
  RTCClient,
  sendMessageToAvatar,
  setAvatarParams,
  interruptResponse,
  log,
  StreamMessage,
  ChatResponsePayload,
} from './agoraHelper';

const client: RTCClient = AgoraRTC.createClient({
  mode: 'rtc',
  codec: 'vp8',
}) as RTCClient;

let audioTrack: IMicrophoneAudioTrack | null;

interface Message {
  id: string;
  text: string;
  isSentByMe: boolean;
}

function App() {
  const [isJoined, setIsJoined] = useState(false);
  const [messageMap, setMessageMap] = useState<Map<string, Message>>(new Map());
  const [messageIds, setMessageIds] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [modeType, setModeType] = useState(2);
  const [language, setLanguage] = useState('en');
  const [voiceId, setVoiceId] = useState('Xb7hH8MSUJpSbSDYk0k2');
  const [openapiHost, setOpenapiHost] = useState('https://openapi.akool.com');
  const [avatarId, setAvatarId] = useState('dvp_Tristan_cloth2_1080P');
  const [avatarVideoUrl, setAvatarVideoUrl] = useState(
    'https://static.website-files.org/assets/avatar/avatar/streaming_avatar/tristan_10s_silence.mp4'
  );
  const [openapiToken, setOpenapiToken] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [api] = useState<ApiService | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [sessionDuration, setSessionDuration] = useState(10);
  const [remoteStats, setRemoteStats] = useState<NetworkStats | null>(null);
  const [useManualAvatarId, setUseManualAvatarId] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Channel management functions
  const joinChannel = async (credentials: Credentials) => {
    const { agora_app_id, agora_channel, agora_token, agora_uid } = credentials;

    if (isJoined) await leaveChannel();

    client.on('exception', onException);
    client.on('user-published', onUserPublish);
    client.on('user-unpublished', onUserUnpublish);
    client.on('token-privilege-will-expire', onTokenWillExpire);
    client.on('token-privilege-did-expire', onTokenDidExpire);

    await client.join(agora_app_id, agora_channel, agora_token, agora_uid);

    client.on('network-quality', (stats: NetworkQuality) => {
      const videoStats = client.getRemoteVideoStats();
      const audioStats = client.getRemoteAudioStats();
      const networkStats = client.getRemoteNetworkQuality();

      const firstVideoStats = Object.values(videoStats)[0] || {};
      const firstAudioStats = Object.values(audioStats)[0] || {};
      const firstNetworkStats = Object.values(networkStats)[0] || {};

      setRemoteStats({
        localNetwork: stats,
        remoteNetwork: firstNetworkStats,
        video: firstVideoStats,
        audio: firstAudioStats,
      });
    });

    setIsJoined(true);
  };

  const leaveChannel = async () => {
    setIsJoined(false);
    if (audioTrack) {
      await client.unpublish(audioTrack);
      audioTrack = null;
    }
    await client.unpublish();
    await client.leave();
    client.removeAllListeners();
  };

  // Event handlers
  const onException = (e: { code: number; msg: string; uid: UID }) => log(e);
  const onTokenWillExpire = () => alert('Session will expire in 30s');
  const onTokenDidExpire = () => {
    alert('Session expired');
    closeStreaming();
  };

  // User publish/unpublish handlers
  const onUserPublish = async (user: IAgoraRTCRemoteUser, mediaType: 'video' | 'audio' | 'datachannel') => {
    log('onUserPublish', user, mediaType);
    if (mediaType === 'video') {
      const remoteTrack = await client.subscribe(user, mediaType);
      remoteTrack.play('remote-video');
    } else if (mediaType === 'audio') {
      const remoteTrack = await client.subscribe(user, mediaType);
      remoteTrack.play();
    }
  };

  const onUserUnpublish = async (user: IAgoraRTCRemoteUser, mediaType: 'video' | 'audio' | 'datachannel') => {
    log('onUserUnpublish', user, mediaType);
    await client.unsubscribe(user, mediaType);
  };

  // Session management
  const startStreaming = async () => {
    if (!api) {
      alert('Please set host and token first');
      return;
    }

    const data = await api.createSession({
      avatar_id: avatarId,
      duration: sessionDuration * 60,
    });
    
    setSession(data);
    await joinChannel(data.credentials);
    await joinChat();
  };

  const closeStreaming = async () => {
    await leaveChat();
    await leaveChannel();
    if (session) await api?.closeSession(session._id);
  };

  // Chat functionality
  const joinChat = async () => {
    client.on('stream-message', onStreamMessage);
    setConnected(true);
    await setAvatarParams(client, { vid: voiceId, lang: language, mode: modeType });
  };

  const leaveChat = async () => {
    client.removeAllListeners('stream-message');
    setMicEnabled(false);
    setConnected(false);
    setMessageIds([]);
    setMessageMap(new Map());
  };

  const onStreamMessage = (_uid: UID, body: Uint8Array) => {
    const msg = new TextDecoder().decode(body);
    const { v, type, mid, pld } = JSON.parse(msg) as StreamMessage;
    
    if (v !== 2) return;
    
    if (type === 'chat') {
      const { text, from } = pld as ChatResponsePayload;
      setMessageMap(prev => {
        const msg_id = `${type}_${mid}`;
        const newMap = new Map(prev);
        
        if (!newMap.has(msg_id)) {
          newMap.set(msg_id, { id: msg_id, text, isSentByMe: from === 'user' });
          setMessageIds(prevIds => [...prevIds, msg_id]);
        } else {
          const msg = newMap.get(msg_id);
          if (msg) msg.text += text;
        }
        
        return newMap;
      });
    }
  };

  // UI handlers
  const sendMessage = async () => {
    setSending(true);
    const messageId = `msg-${Date.now()}`;
    
    setMessageIds(prev => [...prev, messageId]);
    setMessageMap(prev => new Map(prev.set(messageId, {
      id: messageId,
      text: inputMessage,
      isSentByMe: true
    })));

    await sendMessageToAvatar(client, messageId, inputMessage);
    setInputMessage('');
    setSending(false);
  };

  const toggleMic = async () => {
    if (!audioTrack) {
      audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: 'speech_low_quality',
        AEC: true,
        ANS: true,
        AGC: true,
      });
      await client.publish(audioTrack);
      setMicEnabled(true);
    } else {
      audioTrack.stop();
      audioTrack.close();
      await client.unpublish(audioTrack);
      audioTrack = null;
      setMicEnabled(false);
    }
  };

  // Helpers
  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(url);

  useEffect(() => {
    if (api) {
      const fetchData = async () => {
        try {
          const [langList, voiceList, avatarList] = await Promise.all([
            api.getLangList(),
            api.getVoiceList(),
            api.getAvatarList(),
          ]);
          setLanguages(langList);
          setVoices(voiceList);
          setAvatars(avatarList);
        } catch (error) {
          console.error('Error fetching data:', error);
        }
      };
      fetchData();
    }
  }, [api]);

  useEffect(() => {
    if (connected) {
      setAvatarParams(client, { vid: voiceId, lang: language, mode: modeType })
        .catch(console.error);
    }
  }, [connected, language, voiceId, modeType]);

  useEffect(() => {
    if (avatarId) {
      const avatar = avatars.find(a => a.avatar_id === avatarId);
      if (avatar) setAvatarVideoUrl(avatar.url);
    }
  }, [avatarId, avatars]);

  useEffect(() => {
    scrollToBottom();
  }, [messageIds, messageMap]);

  return (
    <>
      <div className="left-side">
        <div className="brand-header">
          <img 
            src="/logo.png" 
            alt="Dear Forever Logo" 
            className="logo"
          />
          <h4>Dear Forever Streaming Demo</h4>
        </div>

        <div>
          <label>
            Host:
            <input 
              value={openapiHost} 
              onChange={(e) => setOpenapiHost(e.target.value)} 
            />
          </label>
        </div>

        <div>
          <label>
            Token:
            <input
              value={openapiToken}
              onChange={(e) => setOpenapiToken(e.target.value)}
              placeholder="Get token from https://akool.com"
            />
          </label>
        </div>

        <div>
          <label>
            Session Duration (minutes):
            <input
              type="number"
              min="1"
              max="60"
              value={sessionDuration}
              onChange={(e) => setSessionDuration(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </label>
        </div>

        <div>
          <label>
            ModeType:
            <select 
              value={modeType} 
              onChange={(e) => setModeType(parseInt(e.target.value))}
            >
              <option value="1">Repeat</option>
              <option value="2">Dialogue</option>
            </select>
          </label>
        </div>

        <div>
          <label>
            Avatar:
            <div className="avatar-selector">
              {!useManualAvatarId ? (
                <select 
                  value={avatarId} 
                  onChange={(e) => setAvatarId(e.target.value)}
                  disabled={!avatars.length}
                >
                  <option value="">Select an avatar</option>
                  {avatars.map((avatar, index) => (
                    <option key={index} value={avatar.avatar_id}>
                      {avatar.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={avatarId}
                  onChange={(e) => setAvatarId(e.target.value)}
                  placeholder="Enter avatar ID"
                />
              )}
              <button
                onClick={() => setUseManualAvatarId(!useManualAvatarId)}
                className="icon-button"
                title={useManualAvatarId ? 'Switch to dropdown' : 'Switch to manual input'}
              >
                <span className="material-icons">
                  {useManualAvatarId ? 'list' : 'edit'}
                </span>
              </button>
            </div>
          </label>
        </div>

        <div>
          <label>
            Language:
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              disabled={!languages.length}
            >
              <option value="">Select a language</option>
              {languages.map((lang) => (
                <option key={lang.lang_code} value={lang.lang_code}>
                  {lang.lang_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <label>
            Voice:
            <select 
              value={voiceId} 
              onChange={(e) => setVoiceId(e.target.value)}
              disabled={!voices.length}
            >
              <option value="">Select a voice</option>
              {voices.map((voice, index) => (
                <option key={index} value={voice.voice_id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="buttons">
          {isJoined ? (
            <button onClick={closeStreaming} className="button-off">
              Close Streaming
            </button>
          ) : (
            <button onClick={startStreaming} className="button-on">
              Start Streaming
            </button>
          )}
        </div>

        {isJoined && remoteStats && <NetworkQualityDisplay stats={remoteStats} />}
      </div>

      <div className="right-side">
        <div className="video-container">
          {isImageUrl(avatarVideoUrl) ? (
            <img
              id="placeholder-image"
              hidden={isJoined}
              src={avatarVideoUrl}
              alt="Avatar placeholder"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <video
              id="placeholder-video"
              hidden={isJoined}
              src={avatarVideoUrl}
              loop
              muted
              playsInline
              autoPlay
            ></video>
          )}
          <video id="remote-video"></video>
        </div>

        <div className="chat-window">
          <div className="chat-messages">
            {messageIds.map((id, index) => {
              const message = messageMap.get(id)!;
              return (
                <div 
                  key={index} 
                  className={`chat-message ${message.isSentByMe ? 'sent' : 'received'}`}
                >
                  {message.text}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input">
            <button
              onClick={toggleMic}
              disabled={sending || !connected}
              className={`icon-button ${sending || !connected ? 'disabled' : ''}`}
              title={micEnabled ? 'Disable microphone' : 'Enable microphone'}
            >
              <span className="material-icons">
                {micEnabled ? 'mic' : 'mic_off'}
              </span>
            </button>

            {!micEnabled && (
              <>
                <input
                  type="text"
                  placeholder="Type a message..."
                  disabled={sending || !connected}
                  className={sending || !connected ? 'disabled' : ''}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyUp={(e) => e.key === 'Enter' && sendMessage()}
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !connected}
                  className={`icon-button ${sending || !connected ? 'disabled' : ''}`}
                  title="Send message"
                >
                  <span className="material-icons">send</span>
                </button>
                <button
                  onClick={() => interruptResponse(client)}
                  disabled={sending || !connected}
                  className={`icon-button ${sending || !connected ? 'disabled' : ''}`}
                  title="Interrupt response"
                >
                  <span className="material-icons">stop</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default App;