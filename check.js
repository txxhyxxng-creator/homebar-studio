
        const { createApp, ref, computed, reactive, onMounted, watch } = Vue;

        createApp({
            setup() {
                const currentTab = ref('home');
                // Firebase / 인증 상태
                const firebaseReady = ref(false);
                const firebaseConfigured = ref(false);
                const currentUser = ref(null);
                const isAdmin = ref(false);
                const impersonationMode = ref(false);
                const impersonationStartedAt = ref(0);
                let impersonationTimeoutId = null;
                const IMPERSONATION_MAX_MS = 30 * 60 * 1000;
                const serviceAccess = reactive({ active: false, validFrom: null, validUntil: null, keyId: null, label: '', reason: '' });
                const authMode = ref('login');
                const authLoading = ref(false);
                const authError = ref('');
                const accessStatusLoading = ref(false);
                const accessStatusError = ref('');
                const authForm = reactive({ email: '', password: '', passwordConfirm: '', accessKey: '' });
                const firebaseStatusMessage = ref('Firebase 연결을 준비하고 있습니다.');
                const adminKeys = ref([]);
                const adminKeysLoading = ref(false);
                const adminUsers = ref([]);
                const adminUsersLoading = ref(false);
                const adminUsersError = ref('');
                const adminUserSearch = ref('');
                const adminUserStatusFilter = ref('all');
                const adminKeySearch = ref('');
                const adminKeyStatusFilter = ref('all');
                const adminAuditLogs = ref([]);
                const adminAuditLoading = ref(false);
                const keyExpandedId = ref(null);
                const generatedAccessKey = ref('');
                const nowTick = ref(Date.now());
                const adminKeyForm = reactive({ label: '', validFrom: new Date().toISOString().slice(0,10), validUntil: '', maxUsers: 1 });
                const contactLink = reactive({ label: '이용 문의 · 키 받기', url: '' });
                const webIcon = ref('');
                const webIconForm = reactive({ preview: '', remove: false });

                // 사용자 프로필 / 1:1 채팅
                const profileForm = reactive({ nickname: '', avatar: '' });
                const profileSaving = ref(false);
                const chatUserSearch = ref('');
                const chatUsers = ref([]);
                const chatLoading = ref(false);
                const selectedChatUser = ref(null);
                const chatMobileView = ref(false);
                const chatMessages = ref([]);
                const chatMessagesLoading = ref(false);
                const chatSending = ref(false);
                const lastChatSentAt = ref(0);
                const chatDraft = ref('');
                const chatUnreadCount = ref(0);
                const chatList = ref([]);
                const chatMessagesEl = ref(null);
                let chatListUnsubscribe = null;
                let chatMessagesUnsubscribe = null;
                let chatListPollTimer = null;
                let profileLoadPromise = null;

                const profileInitial = computed(() => getProfileInitial(profileForm.nickname || currentUser.value?.email || 'B'));
                const filteredChatUsers = computed(() => {
                    const q = String(chatUserSearch.value || '').trim().toLowerCase();
                    return chatUsers.value.filter(u => u.uid !== currentUser.value?.uid && (!q || String(u.nickname || '').toLowerCase().includes(q)));
                });

                const getProfileInitial = (value) => {
                    const text = String(value || '').trim();
                    return (text.charAt(0) || 'B').toUpperCase();
                };
                const sanitizeNickname = (value) => String(value || '').replace(/[<>\n\r\t]/g, '').replace(/\s{2,}/g, ' ').trimStart().slice(0, 20);
                const defaultNickname = () => {
                    const email = String(currentUser.value?.email || '').trim();
                    return sanitizeNickname(email.split('@')[0] || 'BarTail User') || 'BarTail User';
                };
                const ensureMyProfile = async () => {
                    if (!currentUser.value || !hasServiceAccess.value) return null;
                    const token = await getFirebaseIdToken();
                    const response = await apiJson('/api/index?route=profile', { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
                    const data = response.profile || {};
                    profileForm.nickname = sanitizeNickname(data.nickname || defaultNickname()) || defaultNickname();
                    profileForm.avatar = String(data.avatar || '');
                    return data;
                };
                const loadMyProfile = async () => {
                    if (!currentUser.value || !hasServiceAccess.value || impersonationMode.value) return;
                    try { await ensureMyProfile(); } catch (error) { console.error('[BarTail] profile load', error); triggerToast(error.message || '프로필을 불러오지 못했습니다.', 'error'); }
                };
                const saveMyProfile = async () => {
                    if (!firebaseDb || !currentUser.value || !hasServiceAccess.value || impersonationMode.value) return;
                    const nickname = sanitizeNickname(profileForm.nickname);
                    if (nickname.length < 2) return triggerToast('닉네임은 2자 이상 입력해주세요.', 'error');
                    profileSaving.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        const response = await apiJson('/api/index?route=profile', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ nickname, avatar: String(profileForm.avatar || ''), createIfMissing: true }) });
                        profileForm.nickname = sanitizeNickname(response.profile?.nickname || nickname) || nickname;
                        profileForm.avatar = String(response.profile?.avatar || '');
                        await loadChatDirectory();
                        triggerToast('프로필을 저장했습니다.');
                    } catch (error) { triggerToast(error.message || '프로필 저장에 실패했습니다.', 'error'); }
                    finally { profileSaving.value = false; }
                };
                const removeProfileAvatar = async () => { profileForm.avatar = ''; await saveMyProfile(); };
                const handleProfileAvatarUpload = (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return triggerToast('JPG, PNG, WEBP 이미지만 사용할 수 있습니다.', 'error');
                    if (file.size > 8 * 1024 * 1024) return triggerToast('프로필 사진은 8MB 이하만 업로드할 수 있습니다.', 'error');
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const img = new Image();
                        img.onload = () => {
                            const size = 256;
                            const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
                            const ctx = canvas.getContext('2d');
                            const scale = Math.max(size / img.width, size / img.height);
                            const w = img.width * scale, h = img.height * scale;
                            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                            profileForm.avatar = canvas.toDataURL('image/jpeg', 0.78);
                            triggerToast('프로필 사진을 선택했습니다. 저장 버튼을 눌러 적용하세요.');
                        };
                        img.onerror = () => triggerToast('이미지를 읽지 못했습니다.', 'error');
                        img.src = String(ev.target.result || '');
                    };
                    reader.readAsDataURL(file);
                };
                const loadChatDirectory = async () => {
                    if (!firebaseDb || !currentUser.value || !hasServiceAccess.value || impersonationMode.value) return;
                    chatLoading.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson(`/api/index?route=chat-users&t=${Date.now()}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
                        chatUsers.value = (Array.isArray(data.users) ? data.users : []).filter(u => u.uid !== currentUser.value.uid);
                    } catch (error) { console.error('[BarTail] chat directory', error); triggerToast(error.message || '사용자 목록을 불러오지 못했습니다.', 'error'); }
                    finally { chatLoading.value = false; }
                };
                const chatIdFor = (uidA, uidB) => [String(uidA), String(uidB)].sort().join('__');
                const stopChatMessageListener = () => { if (chatMessagesUnsubscribe) { chatMessagesUnsubscribe(); chatMessagesUnsubscribe = null; } };
                const stopChatListListener = () => {
                    if (chatListUnsubscribe) { chatListUnsubscribe(); chatListUnsubscribe = null; }
                    if (chatListPollTimer) { clearInterval(chatListPollTimer); chatListPollTimer = null; }
                };
                const loadChatList = async () => {
                    if (!firebaseDb || !currentUser.value || !hasServiceAccess.value || impersonationMode.value) return;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson(`/api/index?route=chat-list&t=${Date.now()}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
                        chatList.value = Array.isArray(data.chats) ? data.chats : [];
                        chatUnreadCount.value = Number(data.unreadCount || 0);
                    } catch (error) {
                        console.error('[BarTail] chat list', error);
                        if (!chatList.value.length) triggerToast(error.message || '최근 대화를 불러오지 못했습니다.', 'error');
                    }
                };
                const startChatListPolling = () => {
                    stopChatListListener();
                    if (!currentUser.value || !hasServiceAccess.value || impersonationMode.value) return;
                    loadChatList().catch(() => {});
                    chatListPollTimer = setInterval(() => { loadChatList().catch(() => {}); }, 10000);
                };
                const openChatWith = async (person) => {
                    if (!person || !currentUser.value || person.uid === currentUser.value.uid) return;
                    selectedChatUser.value = person;
                    chatMobileView.value = true;
                    chatDraft.value = '';
                    chatMessages.value = [];
                    chatMessagesLoading.value = true;
                    stopChatMessageListener();
                    const chatId = chatIdFor(currentUser.value.uid, person.uid);
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson('/api/index?route=chat-open', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ otherUid: person.uid }) });
                        await loadChatList().catch(() => {});
                        const chatRef = firebaseDb.collection('chats').doc(chatId);
                        chatMessagesUnsubscribe = chatRef.collection('messages').orderBy('createdAt', 'asc').onSnapshot(ms => {
                            chatMessages.value = ms.docs.map(d => ({ id: d.id, ...d.data() }));
                            chatMessagesLoading.value = false;
                            nextTickScrollChat();
                        }, error => { chatMessagesLoading.value = false; console.error('[BarTail] messages', error); triggerToast('메시지를 불러오지 못했습니다.', 'error'); });
                    } catch (error) { chatMessagesLoading.value = false; triggerToast(error.message || '대화를 열지 못했습니다.', 'error'); }
                };
                const closeMobileChat = () => {
                    chatMobileView.value = false;
                    selectedChatUser.value = null;
                    chatDraft.value = '';
                    chatMessages.value = [];
                    stopChatMessageListener();
                };
                const nextTickScrollChat = () => setTimeout(() => { const el = chatMessagesEl.value; if (el) el.scrollTop = el.scrollHeight; }, 60);
                const sendChatMessage = async () => {
                    const text = String(chatDraft.value || '').trim();
                    if (!text || chatSending.value || !selectedChatUser.value || !firebaseDb || !currentUser.value) return;
                    if (Date.now() - lastChatSentAt.value < 700) return triggerToast('메시지를 너무 빠르게 보내고 있습니다.', 'error');
                    if (text.length > 2000) return triggerToast('메시지는 2000자 이하로 입력해주세요.', 'error');
                    chatSending.value = true;
                    try {
                        const other = selectedChatUser.value.uid;
                        const token = await getFirebaseIdToken();
                        await apiJson('/api/index?route=chat-send', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ otherUid: other, text }) });
                        chatDraft.value = '';
                        lastChatSentAt.value = Date.now();
                        await loadChatList().catch(() => {});
                        nextTickScrollChat();
                    } catch (error) { triggerToast(error.message || '메시지 전송에 실패했습니다.', 'error'); }
                    finally { chatSending.value = false; }
                };
                const formatChatTime = (timestamp) => {
                    const d = timestamp?.toDate?.() || (timestamp ? new Date(timestamp) : null);
                    if (!d || Number.isNaN(d.getTime())) return '전송 중';
                    const now = new Date();
                    const sameDay = d.toDateString() === now.toDateString();
                    return sameDay ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
                };
                const contactLinkForm = reactive({ label: '이용 문의 · 키 받기', url: '' });
                const suggestionModal = ref(false);
                const suggestionSubmitting = ref(false);
                const suggestionsLoading = ref(false);
                const catalogSuggestions = ref([]);
                const suggestionForm = reactive({ name: '', brand: '', category: '위스키', abv: 40, image: '', note: '' });
                let firebaseDb = null;
                let firebaseAuth = null;
                let cloudHydrated = false;
                let userSyncTimer = null;
                let catalogSyncTimer = null;
                let accessCheckTimer = null;

                const hasServiceAccess = computed(() => {
                    if (isAdmin.value) return true;
                    if (!serviceAccess.active || !serviceAccess.validUntil) return false;
                    return new Date(serviceAccess.validUntil).getTime() >= nowTick.value;
                });

                const accessRemainingText = computed(() => {
                    if (isAdmin.value) return '관리자';
                    if (!serviceAccess.active || !serviceAccess.validUntil) return '이용권 없음';
                    const diff = new Date(serviceAccess.validUntil).getTime() - nowTick.value;
                    if (diff <= 0) return '만료됨';
                    const totalMinutes = Math.floor(diff / 60000);
                    const days = Math.floor(totalMinutes / 1440);
                    const hours = Math.floor((totalMinutes % 1440) / 60);
                    const minutes = totalMinutes % 60;
                    if (days > 0) return `${days}일 ${hours}시간 남음`;
                    if (hours > 0) return `${hours}시간 ${minutes}분 남음`;
                    return `${Math.max(1, minutes)}분 남음`;
                });

                const WEB_ICON_CACHE_KEY = 'bartail_web_icon_cache_v2';
                const DEFAULT_FAVICON = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2716%27 fill=%27%231a2440%27/%3E%3Ctext x=%2732%27 y=%2741%27 text-anchor=%27middle%27 font-family=%27Arial%27 font-size=%2724%27 font-weight=%27700%27 fill=%27white%27%3EBT%3C/text%3E%3C/svg%3E';

                const applyWebIcon = (icon, persist = true) => {
                    webIcon.value = String(icon || '').trim();
                    if (persist) {
                        try {
                            if (webIcon.value) localStorage.setItem(WEB_ICON_CACHE_KEY, webIcon.value);
                            else localStorage.removeItem(WEB_ICON_CACHE_KEY);
                        } catch (_) {}
                    }
                    const link = document.getElementById('bartail-favicon');
                    if (link) link.href = webIcon.value || DEFAULT_FAVICON;
                };

                // 서버 응답을 기다리는 동안에도 마지막으로 저장된 아이콘을 즉시 보여줍니다.
                try {
                    const cachedIcon = localStorage.getItem(WEB_ICON_CACHE_KEY);
                    if (cachedIcon) applyWebIcon(cachedIcon, false);
                } catch (_) {}

                const compressWebIcon = (file) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
                    reader.onload = () => {
                        const img = new Image();
                        img.onerror = () => reject(new Error('지원하지 않는 이미지입니다.'));
                        img.onload = () => {
                            const render = (size, quality) => {
                                const canvas = document.createElement('canvas');
                                canvas.width = size; canvas.height = size;
                                const ctx = canvas.getContext('2d');
                                if (!ctx) throw new Error('이미지 처리에 실패했습니다.');
                                ctx.clearRect(0, 0, size, size);
                                const scale = Math.min(size / img.width, size / img.height);
                                const w = Math.max(1, Math.round(img.width * scale));
                                const h = Math.max(1, Math.round(img.height * scale));
                                ctx.drawImage(img, Math.round((size-w)/2), Math.round((size-h)/2), w, h);
                                return canvas.toDataURL('image/webp', quality);
                            };
                            // Firestore 문서 크기 제한을 고려해 충분히 작은 WebP로 저장합니다.
                            let result = render(192, 0.68);
                            if (result.length > 220000) result = render(160, 0.60);
                            if (result.length > 220000) result = render(128, 0.52);
                            if (!result || !/^data:image\/webp;base64,/i.test(result)) return reject(new Error('이미지 변환에 실패했습니다.'));
                            if (result.length > 220000) return reject(new Error('이미지를 저장할 수 있는 크기로 압축하지 못했습니다.'));
                            resolve(result);
                        };
                        img.src = reader.result;
                    };
                    reader.readAsDataURL(file);
                });

                const handleWebIconUpload = async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (!file.type.startsWith('image/')) return triggerToast('이미지 파일만 업로드할 수 있습니다.', 'error');
                    if (file.size > 8 * 1024 * 1024) return triggerToast('8MB 이하의 이미지를 선택해주세요.', 'error');
                    try {
                        const encoded = await compressWebIcon(file);
                        webIconForm.preview = encoded;
                        triggerToast('새 아이콘을 준비했습니다. 「새 아이콘 저장」을 눌러 적용하세요.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const cancelWebIconSelection = () => {
                    webIconForm.preview = '';
                };

                const saveWebIcon = async () => {
                    const pendingIcon = String(webIconForm.preview || '').trim();
                    if (!pendingIcon) return triggerToast('먼저 새 사진을 선택해주세요.', 'error');
                    try {
                        // 웹 아이콘 변경은 반드시 서버 API를 통해 처리합니다.
                        // 서버에서 requireAdmin()으로 관리자 여부를 검증하므로
                        // 브라우저의 Firestore Custom Claim 상태와 무관하게
                        // ADMIN_BOOTSTRAP_EMAIL 관리자도 정상적으로 저장할 수 있습니다.
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-settings', {
                            method: 'PATCH',
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ action: 'setWebIcon', webIcon: pendingIcon })
                        });
                        const verifiedIcon = String(data.webIcon || '').trim();
                        if (!verifiedIcon) throw new Error('서버에서 웹 아이콘 저장 결과를 확인하지 못했습니다.');
                        applyWebIcon(verifiedIcon);
                        webIconForm.preview = '';
                        triggerToast('웹 아이콘을 저장하고 적용했습니다.');
                    } catch (error) {
                        console.error('[BarTail] web icon save failed:', error);
                        triggerToast(error.message || '웹 아이콘 저장에 실패했습니다.', 'error');
                    }
                };

                const deleteWebIcon = async () => {
                    if (!webIcon.value) return;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-settings', {
                            method: 'PATCH',
                            headers: {
                                Authorization: `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ action: 'deleteWebIcon' })
                        });
                        const verifiedIcon = String(data.webIcon || '').trim();
                        if (verifiedIcon) throw new Error('서버에서 기존 웹 아이콘 삭제 결과를 확인하지 못했습니다.');
                        applyWebIcon('');
                        webIconForm.preview = '';
                        triggerToast('웹 아이콘을 삭제했습니다.');
                    } catch (error) {
                        console.error('[BarTail] web icon delete failed:', error);
                        triggerToast(error.message || '웹 아이콘 삭제에 실패했습니다.', 'error');
                    }
                };

                const loadPublicSettings = async () => {
                    try {
                        const data = await apiJson(`/api/index?route=public-settings&t=${Date.now()}`, { cache: 'no-store', method: 'GET', headers: {} });
                        contactLink.label = data.contactLink?.label || '이용 문의 · 키 받기';
                        contactLink.url = data.contactLink?.url || '';
                        contactLinkForm.label = contactLink.label;
                        contactLinkForm.url = contactLink.url;
                        // 웹 아이콘은 공개 설정 API가 서버에서 읽어온 최신 값을 사용합니다.
                        // 브라우저가 settings/public을 직접 읽을 필요가 없습니다.
                        applyWebIcon(data.webIcon || '');
                    } catch (error) {
                        console.warn('[HBS] public settings load failed:', error);
                    }
                };

                const openContactLink = () => {
                    if (!contactLink.url) return;
                    window.open(contactLink.url, '_blank', 'noopener,noreferrer');
                };

                const saveContactLink = async () => {
                    const url = String(contactLinkForm.url || '').trim();
                    const label = String(contactLinkForm.label || '').trim() || '이용 문의 · 키 받기';
                    if (url && !/^https?:\/\//i.test(url)) return triggerToast('링크는 http:// 또는 https://로 시작해야 합니다.', 'error');
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-settings', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ contactLink: { label, url } }) });
                        contactLink.label = data.contactLink?.label || label;
                        contactLink.url = data.contactLink?.url || url;
                        contactLinkForm.label = contactLink.label;
                        contactLinkForm.url = contactLink.url;
                        triggerToast('문의 / 이용 키 안내 링크를 저장했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const loadAdminSettings = async () => {
                    if (!isAdmin.value) return;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-settings', { headers: { Authorization: `Bearer ${token}` } });
                        contactLink.label = data.contactLink?.label || '이용 문의 · 키 받기';
                        contactLink.url = data.contactLink?.url || '';
                        contactLinkForm.label = contactLink.label;
                        contactLinkForm.url = contactLink.url;
                        // 관리자 설정 API가 서버에서 읽은 최신 아이콘을 그대로 사용합니다.
                        applyWebIcon(data.webIcon || '');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const openSuggestionModal = () => {
                    if (!hasServiceAccess.value || isAdmin.value) return;
                    Object.assign(suggestionForm, { name: '', brand: '', category: '위스키', abv: 40, image: '', note: '' });
                    suggestionModal.value = true;
                };
                const closeSuggestionModal = () => { suggestionModal.value = false; };

                const submitCatalogSuggestion = async () => {
                    if (!suggestionForm.name.trim()) return triggerToast('제품명을 입력해주세요.', 'error');
                    suggestionSubmitting.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson('/api/index?route=catalog-suggestions', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...suggestionForm, abv: Number(suggestionForm.abv) || 0 }) });
                        suggestionModal.value = false;
                        triggerToast('술 추가 건의가 제출되었습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                    finally { suggestionSubmitting.value = false; }
                };

                const loadCatalogSuggestions = async () => {
                    if (!isAdmin.value) return;
                    suggestionsLoading.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=catalog-suggestions', { headers: { Authorization: `Bearer ${token}` } });
                        catalogSuggestions.value = Array.isArray(data.suggestions) ? data.suggestions : [];
                    } catch (error) { triggerToast(error.message, 'error'); }
                    finally { suggestionsLoading.value = false; }
                };

                const approveCatalogSuggestion = async (item) => {
                    if (!confirm(`'${item.name}'을 전체 술 도감에 추가할까요?`)) return;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson('/api/index?route=catalog-suggestions', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ suggestionId: item.id, action: 'approve' }) });
                        await loadCatalogSuggestions();
                        await hydrateFromCloud();
                        triggerToast('건의한 술을 전체 도감에 추가했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const rejectCatalogSuggestion = async (item) => {
                    if (!confirm(`'${item.name}' 건의를 반려할까요?`)) return;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson('/api/index?route=catalog-suggestions', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ suggestionId: item.id, action: 'reject' }) });
                        await loadCatalogSuggestions();
                        triggerToast('건의를 반려했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const withTimeout = (promise, ms, message) => {
                    let timer = null;
                    const timeout = new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(message)), ms);
                    });
                    return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
                };

                const getFirebaseIdToken = async (forceRefresh = false) => {
                    if (!firebaseAuth?.currentUser) throw new Error('로그인이 필요합니다.');
                    return withTimeout(
                        firebaseAuth.currentUser.getIdToken(forceRefresh),
                        15000,
                        'Firebase 인증 토큰 확인이 지연되고 있습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.'
                    );
                };

                const apiJson = async (url, options = {}) => {
                    const controller = new AbortController();
                    const timeoutMs = Number(options.timeoutMs || 15000);
                    const timer = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const fetchOptions = { ...options, signal: controller.signal };
                        delete fetchOptions.timeoutMs;
                        const response = await fetch(url, { ...fetchOptions, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
                        const data = await response.json().catch(() => ({}));
                        if (!response.ok) {
                            const detail = data.error || `HTTP ${response.status}${response.statusText ? ` · ${response.statusText}` : ''}`;
                            throw new Error(detail);
                        }
                        return data;
                    } catch (error) {
                        if (error?.name === 'AbortError') throw new Error('서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
                        throw error;
                    } finally {
                        clearTimeout(timer);
                    }
                };

                const authErrorMessage = (error) => {
                    const code = String(error?.code || '');
                    const map = {
                        'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
                        'auth/invalid-login-credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
                        'auth/email-already-in-use': '이미 가입된 이메일입니다.',
                        'auth/weak-password': '비밀번호는 더 안전하게 설정해주세요.',
                        'auth/invalid-email': '이메일 형식을 확인해주세요.',
                        'auth/too-many-requests': '잠시 후 다시 시도해주세요.',
                        'auth/user-disabled': '비활성화된 계정입니다. 관리자에게 문의해주세요.',
                        'auth/operation-not-allowed': '이 로그인 방식이 Firebase에서 활성화되어 있지 않습니다.',
                        'auth/network-request-failed': '네트워크 연결을 확인한 뒤 다시 시도해주세요.',
                        'auth/invalid-api-key': 'Firebase API 설정이 올바르지 않습니다.',
                        'auth/app-not-authorized': '현재 도메인이 Firebase 인증 허용 도메인에 등록되지 않았습니다.'
                    };
                    return map[code] || error?.message || '인증 처리 중 오류가 발생했습니다.';
                };

                const applyAccessResult = (data) => {
                    Object.assign(serviceAccess, {
                        active: Boolean(data?.access?.active),
                        validFrom: data?.access?.validFrom || null,
                        validUntil: data?.access?.validUntil || null,
                        keyId: data?.access?.keyId || null,
                        label: data?.access?.label || '',
                        reason: data?.access?.reason || ''
                    });
                };

                const loadAccessStatus = async () => {
                    if (!firebaseAuth?.currentUser) throw new Error('로그인이 필요합니다.');
                    accessStatusLoading.value = true;
                    accessStatusError.value = '';
                    const startedAt = Date.now();
                    try {
                        // 일반 사용자는 자신의 access/meta 문서를 직접 읽습니다.
                        // Vercel 서버 함수가 지연되더라도 로그인 후 권한 확인이 멈추지 않도록 합니다.
                        const user = firebaseAuth.currentUser;
                        if (firebaseDb) {
                            const snap = await withTimeout(
                                firebaseDb.collection('users').doc(user.uid).collection('access').doc('meta').get({ source: 'server' }),
                                7000,
                                '이용 권한 확인이 지연되고 있습니다. Firebase 연결을 확인해주세요.'
                            );
                            if (!snap.exists) {
                                // 일반 사용자는 여기서 바로 이용 키 없음으로 끝내되,
                                // bootstrap 관리자 계정일 가능성이 있으므로 서버 확인을 한 번만 시도합니다.
                                const token = await getFirebaseIdToken(false);
                                const data = await apiJson('/api/index?route=access%2Fstatus', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', timeoutMs: 7000 });
                                isAdmin.value = Boolean(data.admin);
                                applyAccessResult(data);
                                if (data.admin) getFirebaseIdToken(true).catch(() => {});
                                return data;
                            }
                            const data = snap.data() || {};
                            const toMillis = (value) => value?.toDate ? value.toDate().getTime() : (value ? new Date(value).getTime() : null);
                            const from = toMillis(data.validFrom);
                            const until = toMillis(data.validUntil);
                            const now = Date.now();
                            const active = data.active === true && (!from || now >= from) && (!until || now <= until);
                            const result = { admin: false, access: { active, validFrom: from ? new Date(from).toISOString() : null, validUntil: until ? new Date(until).toISOString() : null, keyId: data.keyId || null, label: data.label || '', reason: active ? '' : (data.active === false ? '이용 키가 비활성화되었습니다.' : '이용 키가 만료되었거나 아직 시작되지 않았습니다.') } };
                            isAdmin.value = false;
                            applyAccessResult(result);
                            return result;
                        }

                        // Bootstrap 관리자만 서버에서 claim을 확인/발급합니다.
                        const token = await getFirebaseIdToken(false);
                        const data = await apiJson('/api/index?route=access%2Fstatus', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', timeoutMs: 7000 });
                        isAdmin.value = Boolean(data.admin);
                        applyAccessResult(data);
                        if (data.admin && firebaseAuth?.currentUser) {
                            // claim 갱신은 서비스 진입을 막지 않습니다.
                            getFirebaseIdToken(true).catch(() => {});
                        }
                        return data;
                    } catch (error) {
                        const elapsed = Date.now() - startedAt;
                        accessStatusError.value = error?.message || '이용 권한을 확인하지 못했습니다.';
                        console.error(`[BarTail] access status failed after ${elapsed}ms`, error);
                        throw error;
                    } finally {
                        accessStatusLoading.value = false;
                    }
                };

                const activateAccessKey = async () => {
                    const key = authForm.accessKey.trim();
                    if (!key) { authError.value = '이용 키를 입력해주세요.'; return; }
                    authLoading.value = true; authError.value = '';
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=access%2Factivate', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ key }) });
                        applyAccessResult(data);
                        triggerToast('이용 키가 활성화되었습니다.');
                        await hydrateFromCloud();
                    } catch (error) { authError.value = error.message; }
                    finally { authLoading.value = false; }
                };

                const signIn = async () => {
                    if (!firebaseConfigured.value || !firebaseAuth) { authError.value = 'Firebase 연결이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.'; return; }
                    const email = authForm.email.trim();
                    const password = String(authForm.password || '');
                    if (!email) { authError.value = '이메일을 입력해주세요.'; return; }
                    if (!password) { authError.value = '비밀번호를 입력해주세요.'; return; }
                    authLoading.value = true; authError.value = ''; accessStatusError.value = '';
                    try {
                        await firebaseAuth.signInWithEmailAndPassword(email, password);
                    } catch (error) { authError.value = authErrorMessage(error); }
                    finally { authLoading.value = false; }
                };

                const signUp = async () => {
                    if (!firebaseConfigured.value || !firebaseAuth) { authError.value = 'Firebase 연결이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.'; return; }
                    const email = authForm.email.trim();
                    const password = String(authForm.password || '');
                    if (!email) { authError.value = '이메일을 입력해주세요.'; return; }
                    if (password.length < 6) { authError.value = '비밀번호는 6자 이상 입력해주세요.'; return; }
                    if (password !== authForm.passwordConfirm) { authError.value = '비밀번호 확인이 일치하지 않습니다.'; return; }
                    authLoading.value = true; authError.value = ''; accessStatusError.value = '';
                    try {
                        const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
                        // 회원가입 직후에도 새 ID 토큰을 확보한 뒤 선택한 이용 키를 활성화합니다.
                        if (authForm.accessKey.trim() && credential?.user) {
                            await credential.user.getIdToken(true);
                            await activateAccessKey();
                        }
                    } catch (error) { authError.value = authErrorMessage(error); }
                    finally { authLoading.value = false; }
                };

                const sendPasswordReset = async () => {
                    if (!authForm.email.trim()) { authError.value = '비밀번호 재설정 이메일을 먼저 입력해주세요.'; return; }
                    try { await firebaseAuth.sendPasswordResetEmail(authForm.email.trim()); triggerToast('비밀번호 재설정 메일을 요청했습니다.'); }
                    catch (error) { authError.value = authErrorMessage(error); }
                };

                const signOutUser = async () => {
                    stopChatMessageListener();
                    stopChatListListener();
                    selectedChatUser.value = null;
                    chatMobileView.value = false;
                    chatMessages.value = [];
                    chatList.value = [];
                    chatUnreadCount.value = 0;
                    accessStatusError.value = '';
                    authError.value = '';
                    const wasImpersonating = impersonationMode.value;
                    if (impersonationTimeoutId) { clearTimeout(impersonationTimeoutId); impersonationTimeoutId = null; }
                    if (firebaseAuth) await firebaseAuth.signOut();
                    if (wasImpersonating && window.opener) {
                        try { window.close(); } catch (_) {}
                    }
                };

                const returnToAdmin = async () => {
                    try {
                        if (firebaseAuth) await firebaseAuth.signOut();
                    } finally {
                        impersonationMode.value = false;
                        impersonationStartedAt.value = 0;
                        if (impersonationTimeoutId) { clearTimeout(impersonationTimeoutId); impersonationTimeoutId = null; }
                        if (window.opener) window.close();
                    }
                };

                const loginAsUser = async (user) => {
                    if (!user?.uid || user.isAdmin) return;
                    const email = user.email || user.uid;
                    if (!confirm(`'${email}' 사용자로 새 탭에서 접속할까요?\n\n관리자 권한은 전달되지 않으며, 실제 비밀번호도 필요하지 않습니다.`)) return;
                    const child = window.open('about:blank', '_blank');
                    if (!child) {
                        triggerToast('새 탭이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.', 'error');
                        return;
                    }
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-impersonate', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ uid: user.uid })
                        });
                        child.location.href = `${window.location.origin}${window.location.pathname}#admin-impersonation=${encodeURIComponent(data.token)}`;
                        triggerToast(`${email} 사용자 화면을 새 탭에서 열었습니다.`);
                    } catch (error) {
                        try { child.close(); } catch (_) {}
                        triggerToast(error.message || '사용자 접속에 실패했습니다.', 'error');
                    }
                };

                const handleImpersonationHash = async () => {
                    const prefix = '#admin-impersonation=';
                    if (!window.location.hash.startsWith(prefix) || !firebaseAuth) return false;
                    const token = decodeURIComponent(window.location.hash.slice(prefix.length));
                    history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
                    if (!token) return false;
                    impersonationMode.value = true;
                    authLoading.value = true;
                    authError.value = '';
                    try {
                        await firebaseAuth.signInWithCustomToken(token);
                        impersonationStartedAt.value = Date.now();
                        if (impersonationTimeoutId) clearTimeout(impersonationTimeoutId);
                        impersonationTimeoutId = setTimeout(async () => {
                            impersonationMode.value = false;
                            impersonationStartedAt.value = 0;
                            try { await firebaseAuth.signOut(); } catch (_) {}
                            triggerToast('관리자 사용자 접속 세션이 30분 후 자동 종료되었습니다.', 'error');
                            if (window.opener) { try { window.close(); } catch (_) {} }
                        }, IMPERSONATION_MAX_MS);
                        return true;
                    } catch (error) {
                        impersonationMode.value = false;
                        authError.value = authErrorMessage(error);
                        triggerToast('사용자 접속 토큰이 만료되었거나 유효하지 않습니다.', 'error');
                        return false;
                    } finally {
                        authLoading.value = false;
                    }
                };

                const filteredAdminKeys = computed(() => {
                    const q = adminKeySearch.value.trim().toLowerCase();
                    return adminKeys.value.filter(item => {
                        const matchesSearch = !q || [item.label, item.maskedKey, item.validFrom, item.validUntil].some(v => String(v || '').toLowerCase().includes(q));
                        const matchesStatus = adminKeyStatusFilter.value === 'all' || item.status === adminKeyStatusFilter.value;
                        return matchesSearch && matchesStatus;
                    });
                });

                const filteredAdminUsers = computed(() => {
                    const q = adminUserSearch.value.trim().toLowerCase();
                    return adminUsers.value.filter(user => {
                        const matchesSearch = !q || [user.email, user.uid, user.provider, user.accessLabel].some(v => String(v || '').toLowerCase().includes(q));
                        let matchesStatus = true;
                        if (adminUserStatusFilter.value === 'active') matchesStatus = user.accessActive && !user.disabled;
                        if (adminUserStatusFilter.value === 'expiring') matchesStatus = user.accessExpiresSoon && !user.disabled;
                        if (adminUserStatusFilter.value === 'disabled') matchesStatus = user.disabled;
                        if (adminUserStatusFilter.value === 'inactive') matchesStatus = !user.accessActive && !user.disabled;
                        if (adminUserStatusFilter.value === 'admin') matchesStatus = user.isAdmin;
                        return matchesSearch && matchesStatus;
                    });
                });

                const loadAdminAuditLogs = async () => {
                    if (!isAdmin.value) return;
                    adminAuditLoading.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-audit', { headers: { Authorization: `Bearer ${token}` } });
                        adminAuditLogs.value = Array.isArray(data.logs) ? data.logs : [];
                    } catch (error) {
                        adminAuditLogs.value = [];
                    } finally {
                        adminAuditLoading.value = false;
                    }
                };

                const loadAdminKeys = async () => {
                    if (!isAdmin.value) return;
                    adminKeysLoading.value = true;
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-keys', { headers: { Authorization: `Bearer ${token}` } });
                        adminKeys.value = data.keys || [];
                    } catch (error) { triggerToast(error.message, 'error'); }
                    finally { adminKeysLoading.value = false; }
                };

                const loadAdminUsers = async () => {
                    if (!isAdmin.value) return;
                    adminUsersLoading.value = true;
                    adminUsersError.value = '';
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-users', { headers: { Authorization: `Bearer ${token}` } });
                        adminUsers.value = Array.isArray(data.users) ? data.users : [];
                    } catch (error) {
                        console.error('관리자 사용자 목록 조회 실패:', error);
                        adminUsersError.value = error.message || '사용자 목록을 불러오지 못했습니다.';
                    }
                    finally { adminUsersLoading.value = false; }
                };

                const toggleKeyUsers = (keyId) => {
                    keyExpandedId.value = keyExpandedId.value === keyId ? null : keyId;
                };

                const deleteRegisteredUser = async (user) => {
                    if (!user?.uid || user.isAdmin) return;
                    const email = user.email || user.uid;
                    if (!confirm(`'${email}' 계정을 Firebase Authentication에서 영구 삭제할까요?\n\n개인 데이터와 이용 키 사용 이력도 함께 정리됩니다. 이 작업은 되돌릴 수 없습니다.`)) return;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson(`/api/index?route=admin-users&uid=${encodeURIComponent(user.uid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                        await Promise.all([loadAdminUsers(), loadAdminKeys()]);
                        triggerToast(`${email} 계정을 삭제했습니다.`);
                    } catch (error) {
                        console.error('가입 사용자 삭제 실패:', error);
                        triggerToast(error.message || '사용자 삭제에 실패했습니다.', 'error');
                    }
                };

                const extendAccessKey = async (item) => {
                    const suggested = item.validUntil || new Date().toISOString().slice(0, 10);
                    const newUntil = prompt(`\n${item.label || '이용 키'}의 새 유효 종료일을 입력하세요.\n예: 2026-12-31`, suggested);
                    if (!newUntil) return;
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(newUntil)) return triggerToast('날짜 형식은 YYYY-MM-DD로 입력해주세요.', 'error');
                    if (newUntil < item.validFrom) return triggerToast('종료일은 시작일 이후여야 합니다.', 'error');
                    if (!confirm(`${newUntil}까지 이용 가능하도록 연장하고, 비활성/만료 키라면 다시 활성화할까요?`)) return;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson(`/api/index?route=admin-key&keyId=${encodeURIComponent(item.id)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ validFrom: item.validFrom, validUntil: newUntil, maxUsers: item.maxUsers, label: item.label, active: true }) });
                        await loadAdminKeys();
                        triggerToast('이용 키 기간을 연장하고 활성화했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const deleteAccessKey = async (keyId) => {
                    if (!confirm('비활성 또는 만료된 이용 키를 목록과 데이터베이스에서 완전히 삭제할까요? 등록 이력도 더 이상 이 키에서 확인할 수 없습니다.')) return;
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson(`/api/index?route=admin-key&keyId=${encodeURIComponent(keyId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                        if (keyExpandedId.value === keyId) keyExpandedId.value = null;
                        await loadAdminKeys();
                        triggerToast('이용 키를 완전히 삭제했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const createAccessKey = async () => {
                    if (!adminKeyForm.validUntil) return triggerToast('유효 종료일을 선택해주세요.', 'error');
                    if (adminKeyForm.validUntil < adminKeyForm.validFrom) return triggerToast('종료일은 시작일 이후여야 합니다.', 'error');
                    try {
                        const token = await getFirebaseIdToken();
                        const data = await apiJson('/api/index?route=admin-keys', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...adminKeyForm, maxUsers: Number(adminKeyForm.maxUsers) || 1 }) });
                        generatedAccessKey.value = data.key;
                        adminKeyForm.label = '';
                        await loadAdminKeys();
                        triggerToast('새 이용 키를 발급했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const revokeAccessKey = async (keyId) => {
                    if (!confirm('이 이용 키를 비활성화할까요?')) return;
                    const item = adminKeys.value.find(key => key.id === keyId);
                    try {
                        const token = await getFirebaseIdToken();
                        await apiJson(`/api/index?route=admin-key&keyId=${encodeURIComponent(keyId)}`, {
                            method: 'PATCH',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                active: false,
                                validFrom: item?.validFrom || null,
                                validUntil: item?.validUntil || null,
                                maxUsers: item?.maxUsers || 1,
                                label: item?.label || ''
                            })
                        });
                        await loadAdminKeys();
                        triggerToast('이용 키를 비활성화했습니다.');
                    } catch (error) { triggerToast(error.message, 'error'); }
                };

                const copyGeneratedKey = async () => {
                    if (!generatedAccessKey.value) return;
                    try { await navigator.clipboard.writeText(generatedAccessKey.value); triggerToast('이용 키를 클립보드에 복사했습니다.'); }
                    catch (_) { triggerToast('복사에 실패했습니다.', 'error'); }
                };

                const initializeFirebase = async () => {
                    // 인증 화면이 Firebase/API의 어떤 한 단계에서도 무한 대기하지 않도록
                    // 초기화 전체를 명확한 단계로 분리하고 각 단계에 제한시간을 둡니다.
                    firebaseReady.value = false;
                    firebaseConfigured.value = false;
                    firebaseStatusMessage.value = 'Firebase 연결을 준비하는 중...';

                    // 공개 설정은 인증 초기화와 완전히 분리합니다.
                    loadPublicSettings().catch(error => console.warn('[BarTail] public settings bootstrap failed:', error));

                    try {
                        if (!window.firebase || typeof window.firebase.initializeApp !== 'function') {
                            throw new Error('Firebase SDK를 불러오지 못했습니다. 인터넷 연결 또는 Firebase CDN 차단 여부를 확인해주세요.');
                        }

                        const config = window.HBS_FIREBASE_CONFIG || await apiJson('/api/index?route=config', {
                            method: 'GET',
                            cache: 'no-store',
                            timeoutMs: 8000
                        });

                        if (!config?.apiKey || !config?.projectId || !config?.authDomain) {
                            throw new Error('Firebase 설정을 불러오지 못했습니다. Vercel의 Firebase Web 환경변수를 확인해주세요.');
                        }

                        if (!firebase.apps?.length) firebase.initializeApp(config);
                        firebaseAuth = firebase.auth();
                        firebaseDb = firebase.firestore();

                        if (!firebaseAuth || !firebaseDb) {
                            throw new Error('Firebase Authentication/Firestore 초기화에 실패했습니다.');
                        }

                        firebaseConfigured.value = true;
                        firebaseStatusMessage.value = 'Firebase에 연결되었습니다.';

                        // 관리자 사용자 접속 토큰 확인도 제한시간을 둬 일반 로그인 화면을 막지 않습니다.
                        try {
                            await withTimeout(
                                handleImpersonationHash(),
                                8000,
                                '사용자 접속 세션 확인이 지연되고 있습니다.'
                            );
                        } catch (error) {
                            impersonationMode.value = false;
                            authLoading.value = false;
                            console.warn('[BarTail] impersonation bootstrap skipped:', error);
                        }

                        firebaseAuth.onAuthStateChanged(async (user) => {
                            currentUser.value = user || null;
                            cloudHydrated = false;

                            if (!user) {
                                stopChatListListener();
                                stopChatMessageListener();
                                isAdmin.value = false;
                                accessStatusError.value = '';
                                Object.assign(serviceAccess, { active: false, validFrom: null, validUntil: null, keyId: null, label: '', reason: '' });
                                return;
                            }

                            try {
                                await loadAccessStatus();
                            } catch (error) {
                                console.error('[BarTail] access status', error);
                                authError.value = `로그인은 완료되었지만 이용 권한 확인에 실패했습니다. ${error.message || ''}`.trim();
                                return;
                            }

                            if (!hasServiceAccess.value || impersonationMode.value) return;

                            try {
                                await hydrateFromCloud();
                            } catch (error) {
                                console.error('[BarTail] cloud hydration', error);
                                triggerToast('로그인은 완료되었습니다. 일부 클라우드 데이터를 불러오지 못했습니다.', 'error');
                            }

                            if (hasServiceAccess.value && !impersonationMode.value) {
                                await ensureMyProfile().catch(err => console.warn('[BarTail] profile bootstrap', err));
                                await loadChatDirectory().catch(err => console.warn('[BarTail] chat directory bootstrap', err));
                                startChatListPolling();
                            }

                            if (!isAdmin.value) {
                                adminKeys.value = [];
                                adminUsers.value = [];
                                adminUsersError.value = '';
                            }
                        });
                    } catch (error) {
                        firebaseConfigured.value = false;
                        firebaseStatusMessage.value = error?.message || 'Firebase 초기화에 실패했습니다.';
                        console.error('[BarTail] Firebase initialization failed:', error);
                    } finally {
                        // 어떤 예외/네트워크 지연이 발생해도 로그인 화면은 반드시 spinner에서 빠져나옵니다.
                        firebaseReady.value = true;
                        authLoading.value = false;
                    }
                };


                const sidebarOpen = ref(false);
                const navGroups = reactive({ myBar: true, cocktails: false, community: false, settings: false, admin: false });
                const catalogSearch = ref('');
                const selectedCategory = ref('전체');
                const categories = ['전체', '위스키', '진', '보드카', '럼', '데킬라', '브랜디', '리큐르', '비터스', '베르무트/와인', '기타'];

                // 기타 재료 관리 State
                const nonAlcoholicSearch = ref('');
                const selectedNaCategory = ref('전체');
                const nonAlcoholicCategories = ['전체', '주스', '시럽', '즙/과일', '허브/잎', '탄산/음료', '비터스/기타'];
                const substitutionSearch = ref('');
                const substitutionForm = reactive({ from: '', to: '', note: '' });
                const editingSubstitutionIndex = ref(null);
                const openNaIngredientModal = ref(false);
                const naForm = reactive({ name: '', category: '주스', description: '' });

                // 기본 기타 칵테일 재료 데이터 베이스
                const defaultNonAlcoholicIngredients = ref([
                    { id: 'na_1', name: '라임 즙', category: '즙/과일', owned: false, description: '상큼한 신맛을 내는 필수 시트러스 재료' },
                    { id: 'na_2', name: '레몬 즙', category: '즙/과일', owned: false, description: '대부분의 사워 칵테일의 베이스 즙' },
                    { id: 'na_3', name: '오렌지 주스', category: '주스', owned: false, description: '가리발디, 몽키 글랜드 등의 베이스 주스' },
                    { id: 'na_4', name: '파인애플 주스', category: '주스', owned: false, description: '싱가폴 슬링, 메리 픽포드 등 트로피컬 재료' },
                    { id: 'na_5', name: '설탕 시럽', category: '시럽', owned: false, description: '단맛 밸런스를 맞추는 단순 시럽 (1:1)' },
                    { id: 'na_6', name: '그레나딘 시럽', category: '시럽', owned: false, description: '석류 향과 화려한 붉은색을 더하는 시럽' },
                    { id: 'na_7', name: '민트 잎', category: '허브/잎', owned: false, description: '모히토, 민트 줄렙 등의 신선한 민트' },
                    { id: 'na_8', name: '탄산수', category: '탄산/음료', owned: false, description: '하이볼, 피즈, 모히토에 들어가는 탄산수' },
                    { id: 'na_9', name: '콜라', category: '탄산/음료', owned: false, description: '롱 아일랜드 아이스 티, 럼콕 등 mix' },
                    { id: 'na_10', name: '진저비어', category: '탄산/음료', owned: false, description: '모스코 뮬 등 알싸한 생강 탄산음료' },
                    { id: 'na_11', name: '토닉워터', category: '탄산/음료', owned: false, description: '진 토닉 등 쌉싸름함과 탄산이 느껴지는 음료' },
                    { id: 'na_12', name: '앙고스투라 비터스', category: '비터스/기타', owned: false, description: '올드 패션드, 맨해튼 등의 필수 비터스' },
                    { id: 'na_13', name: '생크림', category: '비터스/기타', owned: false, description: '알렉산더, 라모스 피즈 등의 부드러운 크림' },
                    { id: 'na_14', name: '계란 흰자', category: '비터스/기타', owned: false, description: '클로버 클럽 등의 풍성한 폼 제조용' },
                    { id: 'seed_na_101', name: "자몽 주스", category: "주스", owned: false, description: "팔로마, 그레이하운드, 브라운 더비 등에 활용", abv: 0 },
                    { id: 'seed_na_102', name: "크랜베리 주스", category: "주스", owned: false, description: "코스모폴리탄, 케이프 코드더 등 대표 믹서", abv: 0 },
                    { id: 'seed_na_103', name: "토마토 주스", category: "주스", owned: false, description: "블러디 메리의 핵심 재료", abv: 0 },
                    { id: 'seed_na_104', name: "사과 주스", category: "주스", owned: false, description: "애플 베이스 하이볼과 과일 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_105', name: "패션프루트 퓨레", category: "주스", owned: false, description: "패션프루트 마티니 등 트로피컬 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_106', name: "코코넛 워터", category: "주스", owned: false, description: "가벼운 트로피컬 믹스에 활용", abv: 0 },
                    { id: 'seed_na_107', name: "허니 시럽", category: "시럽", owned: false, description: "허니 사워와 티키 계열의 단맛 보정", abv: 0 },
                    { id: 'seed_na_108', name: "아가베 시럽", category: "시럽", owned: false, description: "데킬라·메스칼 계열 칵테일의 대표 감미료", abv: 0 },
                    { id: 'seed_na_109', name: "메이플 시럽", category: "시럽", owned: false, description: "위스키 사워와 브런치 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_110', name: "오르지 시럽", category: "시럽", owned: false, description: "마이 타이 등 티키 칵테일의 아몬드 풍미", abv: 0 },
                    { id: 'seed_na_111', name: "라즈베리 시럽", category: "시럽", owned: false, description: "클로버 클럽과 프루티 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_112', name: "진저 시럽", category: "시럽", owned: false, description: "진저 계열 칵테일의 향과 단맛 보정", abv: 0 },
                    { id: 'seed_na_113', name: "바닐라 시럽", category: "시럽", owned: false, description: "에스프레소·디저트 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_114', name: "소금 시럽", category: "시럽", owned: false, description: "마가리타류와 사워의 풍미 보정", abv: 0 },
                    { id: 'seed_na_115', name: "라임", category: "즙/과일", owned: false, description: "가니시와 생즙 모두에 활용되는 기본 시트러스", abv: 0 },
                    { id: 'seed_na_116', name: "레몬", category: "즙/과일", owned: false, description: "가니시와 생즙 모두에 활용되는 기본 시트러스", abv: 0 },
                    { id: 'seed_na_117', name: "오렌지", category: "즙/과일", owned: false, description: "올드 패션드, 네그로니 등 가니시", abv: 0 },
                    { id: 'seed_na_118', name: "자몽", category: "즙/과일", owned: false, description: "팔로마와 그레이하운드 가니시", abv: 0 },
                    { id: 'seed_na_119', name: "체리", category: "즙/과일", owned: false, description: "맨해튼·올드 패션드 등에 활용", abv: 0 },
                    { id: 'seed_na_120', name: "파인애플", category: "즙/과일", owned: false, description: "티키·트로피컬 칵테일의 대표 과일", abv: 0 },
                    { id: 'seed_na_121', name: "오이", category: "즙/과일", owned: false, description: "진·보드카 칵테일의 산뜻한 가니시", abv: 0 },
                    { id: 'seed_na_122', name: "딸기", category: "즙/과일", owned: false, description: "프루티 사워와 스프리츠에 활용", abv: 0 },
                    { id: 'seed_na_123', name: "베리 믹스", category: "즙/과일", owned: false, description: "프루티 칵테일의 가니시와 퓨레용", abv: 0 },
                    { id: 'seed_na_124', name: "바질 잎", category: "허브/잎", owned: false, description: "진·보드카·토마토 계열 칵테일에 활용", abv: 0 },
                    { id: 'seed_na_125', name: "로즈마리", category: "허브/잎", owned: false, description: "진토닉과 스모키 칵테일의 향 가니시", abv: 0 },
                    { id: 'seed_na_126', name: "타임", category: "허브/잎", owned: false, description: "허브 향을 더하는 가니시", abv: 0 },
                    { id: 'seed_na_127', name: "세이지", category: "허브/잎", owned: false, description: "위스키·진 계열의 허브 가니시", abv: 0 },
                    { id: 'seed_na_128', name: "소다수", category: "탄산/음료", owned: false, description: "하이볼, 톰 콜린스, 피즈의 기본 탄산 믹서", abv: 0 },
                    { id: 'seed_na_129', name: "진저에일", category: "탄산/음료", owned: false, description: "위스키 진저와 모스코 뮬 변형에 활용", abv: 0 },
                    { id: 'seed_na_130', name: "레모네이드", category: "탄산/음료", owned: false, description: "보드카·진 기반 롱드링크에 활용", abv: 0 },
                    { id: 'seed_na_131', name: "클럽 소다", category: "탄산/음료", owned: false, description: "스프리츠·피즈·하이볼에 활용", abv: 0 },
                    { id: 'seed_na_132', name: "자몽 소다", category: "탄산/음료", owned: false, description: "팔로마를 간단하게 만들 때 활용", abv: 0 },
                    { id: 'seed_na_133', name: "오렌지 비터스", category: "비터스/기타", owned: false, description: "마티니·올드 패션드의 향 보강", abv: 0 },
                    { id: 'seed_na_134', name: "초콜릿 비터스", category: "비터스/기타", owned: false, description: "디저트·위스키 칵테일의 향 보강", abv: 0 },
                    { id: 'seed_na_135', name: "살라인 솔루션", category: "비터스/기타", owned: false, description: "소량으로 단맛과 산미의 균형을 보정", abv: 0 },
                    { id: 'seed_na_136', name: "코코넛 크림", category: "비터스/기타", owned: false, description: "피냐 콜라다와 티키 계열에 활용", abv: 0 },
                    { id: 'seed_na_137', name: "아쿠아파바", category: "비터스/기타", owned: false, description: "계란 흰자 대신 폼을 만들 때 활용", abv: 0 },
                    { id: 'seed_na_138', name: "계란", category: "비터스/기타", owned: false, description: "플립과 에그노그 계열 칵테일에 활용", abv: 0 }
                ]);

                // 기본 주류 시드 데이터: 칵테일 바에서 자주 쓰이는 글로벌 브랜드/스타일을 넓게 제공합니다.
                const defaultCatalogSeed = [
                    { id: 'seed_1', name: "버번 위스키", brand: "Maker’s Mark", category: "위스키", abv: 45, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_2', name: "버번 위스키", brand: "Bulleit Bourbon", category: "위스키", abv: 45, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_3', name: "버번 위스키", brand: "Woodford Reserve", category: "위스키", abv: 43.2, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_4', name: "버번 위스키", brand: "Wild Turkey 101", category: "위스키", abv: 50.5, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_5', name: "테네시 위스키", brand: "Jack Daniel’s Old No. 7", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_6', name: "버번 위스키", brand: "Jim Beam White", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_7', name: "버번 위스키", brand: "Four Roses Bourbon", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_8', name: "버번 위스키", brand: "Knob Creek 9", category: "위스키", abv: 50, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_9', name: "라이 위스키", brand: "Bulleit Rye", category: "위스키", abv: 45, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_10', name: "스카치 위스키", brand: "Johnnie Walker Black Label", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_11', name: "스카치 위스키", brand: "Monkey Shoulder", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_12', name: "스카치 위스키", brand: "Glenfiddich 12", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_13', name: "스카치 위스키", brand: "Glenlivet 12", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_14', name: "아이리시 위스키", brand: "Jameson", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_15', name: "아이리시 위스키", brand: "Redbreast 12", category: "위스키", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1667823649664-7636a8517d84?auto=format&fit=crop&fm=jpg&q=80&w=1200" },
                    { id: 'seed_16', name: "드라이 진", brand: "Tanqueray London Dry", category: "진", abv: 43.1, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_17', name: "드라이 진", brand: "Beefeater London Dry", category: "진", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_18', name: "드라이 진", brand: "Gordon’s London Dry", category: "진", abv: 37.5, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_19', name: "드라이 진", brand: "Hendrick’s Gin", category: "진", abv: 41.4, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_20', name: "드라이 진", brand: "Roku Gin", category: "진", abv: 43, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_21', name: "드라이 진", brand: "Plymouth Gin", category: "진", abv: 41.2, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_22', name: "드라이 진", brand: "Monkey 47", category: "진", abv: 47, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_23', name: "드라이 진", brand: "Bombay Sapphire", category: "진", abv: 47, status: 'none', image: "https://images.unsplash.com/photo-1664021217644-d16d9b312f95?fit=max&fm=jpg&h=1200&q=80&w=1200" },
                    { id: 'seed_24', name: "보드카", brand: "Absolut Vodka", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_25', name: "보드카", brand: "Smirnoff No.21", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_26', name: "보드카", brand: "Ketel One", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_27', name: "보드카", brand: "Grey Goose", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_28', name: "보드카", brand: "Belvedere", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_29', name: "보드카", brand: "Tito’s Handmade Vodka", category: "보드카", abv: 40, status: 'none', image: "https://users-photos.b-cdn.net/44931/media/asset/BOTTLE%20HERO-2%20copy.jpg?width=900" },
                    { id: 'seed_30', name: "화이트 럼", brand: "Bacardi Carta Blanca", category: "럼", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_31', name: "화이트 럼", brand: "Havana Club 3 Años", category: "럼", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_32', name: "화이트 럼", brand: "Planteray 3 Stars", category: "럼", abv: 41.2, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_33', name: "다크 럼", brand: "Planteray Original Dark", category: "럼", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_34', name: "골드 럼", brand: "Mount Gay Eclipse", category: "럼", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_35', name: "골드 럼", brand: "Appleton Estate Signature", category: "럼", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_36', name: "스파이스드 럼", brand: "Captain Morgan Original Spiced Gold", category: "럼", abv: 35, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_37', name: "오버프루프 럼", brand: "Wray & Nephew White Overproof", category: "럼", abv: 63, status: 'none', image: "https://images.unsplash.com/photo-1648963897952-77329b73b05a?fm=jpg&q=80&w=1200" },
                    { id: 'seed_38', name: "블랑코 데킬라", brand: "Espolòn Blanco", category: "데킬라", abv: 40, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_39', name: "블랑코 데킬라", brand: "Don Julio Blanco", category: "데킬라", abv: 40, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_40', name: "블랑코 데킬라", brand: "Patrón Silver", category: "데킬라", abv: 40, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_41', name: "블랑코 데킬라", brand: "Olmeca Altos Plata", category: "데킬라", abv: 38, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_42', name: "블랑코 데킬라", brand: "Jose Cuervo Tradicional Plata", category: "데킬라", abv: 38, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_43', name: "블랑코 데킬라", brand: "Casamigos Blanco", category: "데킬라", abv: 40, status: 'none', image: "https://lcdn.mediagalaxy.ro/media/catalog/product/5/9/5941934019902_3_6a40ef82.jpg" },
                    { id: 'seed_44', name: "코냑", brand: "Hennessy V.S", category: "브랜디", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_45', name: "코냑", brand: "Rémy Martin 1738 Accord Royal", category: "브랜디", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_46', name: "코냑", brand: "Martell VS", category: "브랜디", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_47', name: "브랜디", brand: "St-Rémy XO", category: "브랜디", abv: 40, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_48', name: "브랜디", brand: "Torres 10", category: "브랜디", abv: 38, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_49', name: "오렌지 리큐르", brand: "Cointreau", category: "리큐르", abv: 40, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_50', name: "오렌지 리큐르", brand: "Grand Marnier Cordon Rouge", category: "리큐르", abv: 40, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_51', name: "마라스키노 리큐르", brand: "Luxardo Maraschino", category: "리큐르", abv: 32, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_52', name: "커피 리큐르", brand: "Kahlúa", category: "리큐르", abv: 20, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_53', name: "아마레토", brand: "Disaronno Originale", category: "리큐르", abv: 28, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_54', name: "아이리시 크림", brand: "Baileys Original Irish Cream", category: "리큐르", abv: 17, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_55', name: "라즈베리 리큐르", brand: "Chambord", category: "리큐르", abv: 16.5, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_56', name: "헤이즐넛 리큐르", brand: "Frangelico", category: "리큐르", abv: 20, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_57', name: "멜론 리큐르", brand: "Midori", category: "리큐르", abv: 20, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_58', name: "허브 리큐르", brand: "Bénédictine D.O.M.", category: "리큐르", abv: 40, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_59', name: "허브 리큐르", brand: "Chartreuse Green", category: "리큐르", abv: 55, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_60', name: "엘더플라워 리큐르", brand: "St-Germain", category: "리큐르", abv: 20, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_61', name: "아페롤", brand: "Aperol", category: "리큐르", abv: 11, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_62', name: "캄파리", brand: "Campari", category: "리큐르", abv: 25, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_63', name: "리큐르", brand: "Drambuie", category: "리큐르", abv: 40, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_64', name: "피치 리큐르", brand: "Peach Schnapps", category: "리큐르", abv: 20, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_65', name: "드라이 베르무트", brand: "Martini Extra Dry", category: "베르무트/와인", abv: 18, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_66', name: "스위트 베르무트", brand: "Martini Rosso", category: "베르무트/와인", abv: 15, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_67', name: "드라이 베르무트", brand: "Dolin Dry", category: "베르무트/와인", abv: 17.5, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_68', name: "스위트 베르무트", brand: "Carpano Antica Formula", category: "베르무트/와인", abv: 16.5, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_69', name: "아페리티프 와인", brand: "Lillet Blanc", category: "베르무트/와인", abv: 17, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_70', name: "아페리티프 와인", brand: "Lillet Rosé", category: "베르무트/와인", abv: 17, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_71', name: "스파클링 와인", brand: "Martini Prosecco", category: "베르무트/와인", abv: 11.5, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_72', name: "스파클링 와인", brand: "Mumm Cordon Rouge Champagne", category: "베르무트/와인", abv: 12, status: 'none', image: "https://elmaridajelicoreria.com/cdn/shop/files/LICORVERMOUTHMARTINIEROSSIEXTRADRY750ML_1.png?v=1756242086" },
                    { id: 'seed_73', name: "비터스", brand: "Angostura Aromatic Bitters", category: "비터스", abv: 44.7, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_74', name: "비터스", brand: "Peychaud’s Bitters", category: "비터스", abv: 35, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_75', name: "비터스", brand: "Regan’s Orange Bitters No. 6", category: "비터스", abv: 45, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_76', name: "아니스 리큐르", brand: "Pernod Absinthe", category: "기타", abv: 68, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_77', name: "아페리티프", brand: "Ricard Pastis", category: "기타", abv: 45, status: 'none', image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=900&auto=format&fit=crop&q=80" },
                    { id: 'seed_78', name: "아마로", brand: "Fernet-Branca", category: "기타", abv: 39, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" },
                    { id: 'seed_79', name: "아마로", brand: "Amaro Montenegro", category: "기타", abv: 23, status: 'none', image: "https://lacaretalicores.com/cdn/shop/files/DSC7862.jpg?v=1739818776" }
                ];

                // 도감 및 레시피 기본 데이터
                const catalog = ref([
                    { id: 'c_1', name: '버번 위스키', brand: '버팔로 트레이스', category: '위스키', abv: 45, status: 'owned', image: 'https://images.unsplash.com/photo-1527281400683-1aae777175f8?w=500&auto=format&fit=crop&q=60' },
                    { id: 'c_2', name: '드라이 진', brand: '봄베이 사파이어', category: '진', abv: 47, status: 'owned', image: 'https://images.unsplash.com/photo-1608885898957-a559228e8749?w=500&auto=format&fit=crop&q=60' },
                    { id: 'c_3', name: '스위트 베르무트', brand: '마르티니 로소', category: '베르무트/와인', abv: 16, status: 'owned', image: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=500&auto=format&fit=crop&q=60' },
                    { id: 'c_4', name: '캄파리', brand: 'Campari', category: '리큐르', abv: 25, status: 'owned', image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=500&auto=format&fit=crop&q=60' },
                    ...defaultCatalogSeed
                ]);

                const recipes = ref([]);

                // IBA 공식 검색 및 필터 State
                const ibaSearch = ref('');
                const ibaCategory = ref('전체');
                // IBA 개인 기록: 즐겨찾기/마셔봄 상태는 내 레시피와 분리해 도감에서 독립적으로 유지합니다.
                const ibaMeta = reactive({});
                const ibaStatusFilter = ref('전체');
                // 카탈로그 위시리스트 보기: 카테고리 필터와 독립적으로 동작합니다.
                const catalogWishlistOnly = ref(false);

                // 모달 컨트롤
                const openItemModal = ref(false);
                const openRecipeModal = ref(false);
                const showTastingModal = ref(false);
                const showIbaDetailModal = ref(false);
                const selectedIbaDetail = ref(null);
                const editingItem = ref(null);
                const editingRecipe = ref(null);
                const currentTastingTarget = ref(null);

                // 토스트 및 커스텀 확인 창
                const toast = reactive({ show: false, message: '', type: 'info' });
                const confirmModal = reactive({ show: false, title: '', message: '', action: null });

                const triggerToast = (msg, type = 'info') => {
                    toast.message = msg;
                    toast.type = type;
                    toast.show = true;
                    setTimeout(() => toast.show = false, 3000);
                };

                const openConfirmModal = (title, message, actionFn) => {
                    confirmModal.title = title;
                    confirmModal.message = message;
                    confirmModal.action = actionFn;
                    confirmModal.show = true;
                };

                const executeConfirmAction = () => {
                    if (confirmModal.action) confirmModal.action();
                    confirmModal.show = false;
                };

                // 재료 피커
                const openIngredientPickerModal = ref(false);
                const pickerTab = ref('catalog');
                const pickerSearch = ref('');
                const selectedIngredientName = ref('');
                const selectedIngredientAbv = ref(0);
                const customIngredientName = ref('');
                const customIngredientAbv = ref(0);
                const selectedAmount = ref('30ml');
                const customAmountInput = ref('');

                const itemForm = reactive({ name: '', brand: '', category: '위스키', abv: 40, status: 'none', image: '', imageSource: '', imageSourcePage: '' });
                const showCustomCellarModal = ref(false);
                const customCellar = ref([]);
                const customCellarForm = reactive({ name: '', brand: '', category: '위스키', abv: 40, image: '' });
                const fallbackBottleImage = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500&auto=format&fit=crop&q=60';
                const imageSearchResults = ref([]);
                const imageSearchLoading = ref(false);
                const recipeForm = reactive({ name: '', category: '커스텀', description: '', ingredients: [] });

                const tastingForm = reactive({
                    rating: 5, nosing: '', tasting: '', finish: '', review: '',
                    date: new Date().toISOString().substring(0, 10)
                });

                // FULL IBA Official Cocktail Database (현재 공식 목록 102종)
                const ibaOfficialDatabase = [
                    {
                                        "id": "iba_001",
                                        "name": "알렉산더 (Alexander)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "크렘 드 카카오 (브라운)",
                                                                                "amount": "30ml",
                                                                                "abv": 24
                                                            },
                                                            {
                                                                                "name": "생크림",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_002",
                                        "name": "아메리카노 (Americano)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 8,
                                        "ingredients": [
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "30ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "30ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_003",
                                        "name": "엔젤 페이스 (Angel Face)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 23,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "애프리콧 브랜디",
                                                                                "amount": "30ml",
                                                                                "abv": 24
                                                            },
                                                            {
                                                                                "name": "칼바도스",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_004",
                                        "name": "애비에이션 (Aviation)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "크렘 드 바이올렛",
                                                                                "amount": "1 bar spoon",
                                                                                "abv": 20
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_005",
                                        "name": "비트윈 더 시트 (Between the Sheets)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 26,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_006",
                                        "name": "불바디에 (Boulevardier)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 27,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "45ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "30ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "30ml",
                                                                                "abv": 16
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_007",
                                        "name": "브랜디 크러스타 (Brandy Crusta)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "브랜디",
                                                                                "amount": "52.5ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "7.5ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "큐라소",
                                                                                "amount": "1 bar spoon",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "심플 시럽",
                                                                                "amount": "1 bar spoon",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_008",
                                        "name": "카지노 (Casino)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "올드 톰 진",
                                                                                "amount": "40ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "10ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "오렌지 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_009",
                                        "name": "클로버 클럽 (Clover Club)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "라즈베리 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "계란흰자",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_010",
                                        "name": "다이키리 (Daiquiri)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 26,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "2 tsp",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_011",
                                        "name": "드라이 마티니 (Dry Martini)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 39,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "60ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "드라이 베르무트",
                                                                                "amount": "10ml",
                                                                                "abv": 18
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_012",
                                        "name": "진 피즈 (Gin Fizz)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 17,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "80ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_013",
                                        "name": "행키 팽키 (Hanky Panky)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "45ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "페르넷 브랑카",
                                                                                "amount": "7.5ml",
                                                                                "abv": 39
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_014",
                                        "name": "존 콜린스 (John Collins)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "60ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_015",
                                        "name": "라스트 워드 (Last Word)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "22.5ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "그린 샤르트뢰즈",
                                                                                "amount": "22.5ml",
                                                                                "abv": 55
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "22.5ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_016",
                                        "name": "맨해튼 (Manhattan)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 30,
                                        "ingredients": [
                                                            {
                                                                                "name": "라이 위스키",
                                                                                "amount": "50ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "20ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "1 dash",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_017",
                                        "name": "마르티네즈 (Martinez)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "45ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "1 bar spoon",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "오렌지 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_018",
                                        "name": "메리 픽포드 (Mary Pickford)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "45ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "7.5ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "그레나딘 시럽",
                                                                                "amount": "7.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_019",
                                        "name": "몽키 글랜드 (Monkey Gland)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "45ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "압생트",
                                                                                "amount": "1 tsp",
                                                                                "abv": 60
                                                            },
                                                            {
                                                                                "name": "그레나딘 시럽",
                                                                                "amount": "1 tsp",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_020",
                                        "name": "네그로니 (Negroni)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "30ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "30ml",
                                                                                "abv": 16
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_021",
                                        "name": "올드 패션드 (Old Fashioned)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 32,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "45ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "설탕",
                                                                                "amount": "1 cube",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "물",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_022",
                                        "name": "파라다이스 (Paradise)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "애프리콧 브랜디",
                                                                                "amount": "20ml",
                                                                                "abv": 24
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_023",
                                        "name": "플랜터스 펀치 (Planter’s Punch)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "다크 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_024",
                                        "name": "포르토 플립 (Porto Flip)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 16,
                                        "ingredients": [
                                                            {
                                                                                "name": "브랜디",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "포트 와인",
                                                                                "amount": "45ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "계란 노른자",
                                                                                "amount": "1개",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "육두구",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_025",
                                        "name": "라모스 진 피즈 (Ramos Fizz)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 10,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "45ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "생크림",
                                                                                "amount": "60ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "계란흰자",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "오렌지 플라워 워터",
                                                                                "amount": "3 drops",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "60ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_026",
                                        "name": "리멤버 더 메인 (Remember the Maine)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 31,
                                        "ingredients": [
                                                            {
                                                                                "name": "라이 위스키",
                                                                                "amount": "60ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "22.5ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "체리 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "압생트",
                                                                                "amount": "1 tsp",
                                                                                "abv": 60
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_027",
                                        "name": "러스티 네일 (Rusty Nail)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 27,
                                        "ingredients": [
                                                            {
                                                                                "name": "스카치 위스키",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "드람뷔이",
                                                                                "amount": "25ml",
                                                                                "abv": 40
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_028",
                                        "name": "사제락 (Sazerac)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 31,
                                        "ingredients": [
                                                            {
                                                                                "name": "라이 위스키",
                                                                                "amount": "50ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "압생트",
                                                                                "amount": "10ml",
                                                                                "abv": 60
                                                            },
                                                            {
                                                                                "name": "설탕",
                                                                                "amount": "1 cube",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "페이쇼 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 35
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_029",
                                        "name": "사이드카 (Sidecar)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "20ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_030",
                                        "name": "스팅어 (Stinger)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "브랜디",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "화이트 크렘 드 멘트",
                                                                                "amount": "20ml",
                                                                                "abv": 25
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_031",
                                        "name": "턱시도 (Tuxedo)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "드라이 베르무트",
                                                                                "amount": "30ml",
                                                                                "abv": 18
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "1/2 bar spoon",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "압생트",
                                                                                "amount": "1/4 bar spoon",
                                                                                "abv": 60
                                                            },
                                                            {
                                                                                "name": "오렌지 비터스",
                                                                                "amount": "3 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_032",
                                        "name": "비외 카레 (Vieux Carré)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "라이 위스키",
                                                                                "amount": "30ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "30ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "베네딕틴",
                                                                                "amount": "1 bar spoon",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "페이쇼 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 35
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_033",
                                        "name": "위스키 사워 (Whiskey Sour)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "45ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "계란흰자",
                                                                                "amount": "선택",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_034",
                                        "name": "화이트 레이디 (White Lady)",
                                        "category": "The Unforgettables",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "40ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_035",
                                        "name": "벨리니 (Bellini)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 7,
                                        "ingredients": [
                                                            {
                                                                                "name": "프로세코",
                                                                                "amount": "100ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "화이트 복숭아 퓌레",
                                                                                "amount": "50ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_036",
                                        "name": "블랙 러시안 (Black Russian)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "커피 리큐르",
                                                                                "amount": "20ml",
                                                                                "abv": 20
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_037",
                                        "name": "블러디 메리 (Bloody Mary)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "토마토 주스",
                                                                                "amount": "90ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "우스터소스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "타바스코",
                                                                                "amount": "취향껏",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "셀러리 솔트",
                                                                                "amount": "취향껏",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "후추",
                                                                                "amount": "취향껏",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_038",
                                        "name": "카이피리냐 (Caipirinha)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "카샤사",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임",
                                                                                "amount": "1개",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "백설탕",
                                                                                "amount": "4 tsp",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_039",
                                        "name": "카르디날레 (Cardinale)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "40ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "드라이 베르무트",
                                                                                "amount": "20ml",
                                                                                "abv": 18
                                                            },
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "10ml",
                                                                                "abv": 25
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_040",
                                        "name": "샴페인 칵테일 (Champagne Cocktail)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "샴페인",
                                                                                "amount": "90ml",
                                                                                "abv": 12
                                                            },
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "10ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "설탕",
                                                                                "amount": "1 cube",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "그랑 마니에르",
                                                                                "amount": "few drops",
                                                                                "abv": 40
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_041",
                                        "name": "콥스 리바이버 #2 (Corpse Reviver #2)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "코인트로",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "릴레 블랑",
                                                                                "amount": "30ml",
                                                                                "abv": 17
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "압생트",
                                                                                "amount": "1 dash",
                                                                                "abv": 60
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_042",
                                        "name": "코스모폴리탄 (Cosmopolitan)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "시트러스 보드카",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "크랜베리 주스",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_043",
                                        "name": "쿠바 리브레 (Cuba Libre)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 14,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "콜라",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_044",
                                        "name": "프렌치 75 (French 75)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 17,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "샴페인",
                                                                                "amount": "60ml",
                                                                                "abv": 12
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_045",
                                        "name": "프렌치 커넥션 (French Connection)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "코냑",
                                                                                "amount": "35ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "아마레또",
                                                                                "amount": "35ml",
                                                                                "abv": 28
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_046",
                                        "name": "가리발디 (Garibaldi)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 8,
                                        "ingredients": [
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "45ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_047",
                                        "name": "그래스호퍼 (Grasshopper)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 8,
                                        "ingredients": [
                                                            {
                                                                                "name": "그린 크렘 드 멘트",
                                                                                "amount": "30ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "화이트 크렘 드 카카오",
                                                                                "amount": "30ml",
                                                                                "abv": 24
                                                            },
                                                            {
                                                                                "name": "생크림",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_048",
                                        "name": "헤밍웨이 스페셜 (Hemingway Special)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "자몽 주스",
                                                                                "amount": "40ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_049",
                                        "name": "호스 넥 (Horse’s Neck)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 11,
                                        "ingredients": [
                                                            {
                                                                                "name": "브랜디",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "진저 에일",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_050",
                                        "name": "아이리시 커피 (Irish Coffee)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "아이리시 위스키",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "뜨거운 커피",
                                                                                "amount": "80ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕",
                                                                                "amount": "1 tsp",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "휘핑크림",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_051",
                                        "name": "키르 (Kir)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 11,
                                        "ingredients": [
                                                            {
                                                                                "name": "드라이 화이트 와인",
                                                                                "amount": "90ml",
                                                                                "abv": 12
                                                            },
                                                            {
                                                                                "name": "크렘 드 카시스",
                                                                                "amount": "10ml",
                                                                                "abv": 20
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_052",
                                        "name": "레몬 드롭 마티니 (Lemon Drop Martini)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "20ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_053",
                                        "name": "롱 아일랜드 아이스 티 (Long Island Iced Tea)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "진",
                                                                                "amount": "15ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "25ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "콜라",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_054",
                                        "name": "마이 타이 (Mai Tai)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "자메이칸 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "럼 아그리콜",
                                                                                "amount": "30ml",
                                                                                "abv": 50
                                                            },
                                                            {
                                                                                "name": "오렌지 큐라소",
                                                                                "amount": "15ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "오르제 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "7.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_055",
                                        "name": "마가리타 (Margarita)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "트리플 섹",
                                                                                "amount": "20ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_056",
                                        "name": "미모사 (Mimosa)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 6,
                                        "ingredients": [
                                                            {
                                                                                "name": "샴페인",
                                                                                "amount": "75ml",
                                                                                "abv": 12
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "75ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_057",
                                        "name": "민트 줄렙 (Mint Julep)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "60ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "민트",
                                                                                "amount": "4 sprigs",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_058",
                                        "name": "모히토 (Mojito)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "민트 잎",
                                                                                "amount": "6 sprigs",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "약간",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_059",
                                        "name": "모스코 뮬 (Moscow Mule)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 13,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "진저 비어",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_060",
                                        "name": "피냐 콜라다 (Piña Colada)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 13,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "코코넛 크림",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "50ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_061",
                                        "name": "피스코 사워 (Pisco Sour)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "피스코",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "계란흰자",
                                                                                "amount": "1개",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "몇 방울",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_062",
                                        "name": "라보 데 갈로 (Rabo de Galo)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 26,
                                        "ingredients": [
                                                            {
                                                                                "name": "카샤사",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "20ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "15ml",
                                                                                "abv": 25
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_063",
                                        "name": "씨 브리즈 (Sea Breeze)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 10,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "크랜베리 주스",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "자몽 주스",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_064",
                                        "name": "섹스 온 더 비치 (Sex on the Beach)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 10,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "피치 슈냅스",
                                                                                "amount": "20ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "40ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "크랜베리 주스",
                                                                                "amount": "40ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_065",
                                        "name": "싱가포르 슬링 (Singapore Sling)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 10,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "체리 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "쿠앵트로",
                                                                                "amount": "7.5ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "베네딕틴",
                                                                                "amount": "7.5ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "그레나딘 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "1 dash",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_066",
                                        "name": "테킬라 선라이즈 (Tequila Sunrise)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "90ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "그레나딘 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_067",
                                        "name": "베스퍼 (Vesper)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 37,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "60ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "15ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "릴레 블랑",
                                                                                "amount": "7.5ml",
                                                                                "abv": 17
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_068",
                                        "name": "좀비 (Zombie)",
                                        "category": "Contemporary Classics",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "다크 자메이칸 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "골드 푸에르토리코 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "데메라라 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "자몽 주스",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "시나몬 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "팔러넘",
                                                                                "amount": "10ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "그레나딘 시럽",
                                                                                "amount": "1 tsp",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "1 dash",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_069",
                                        "name": "비즈 니즈 (Bee’s Knees)",
                                        "category": "New Era",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "드라이 진",
                                                                                "amount": "52.5ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "허니 시럽",
                                                                                "amount": "2 tsp",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_070",
                                        "name": "브램블 (Bramble)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "50ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "25ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "12.5ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "크렘 드 뮈르",
                                                                                "amount": "15ml",
                                                                                "abv": 16
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_071",
                                        "name": "칸찬차라 (Canchanchara)",
                                        "category": "New Era",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "쿠바 아구아르디엔테",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "생꿀",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "물",
                                                                                "amount": "50ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_072",
                                        "name": "샤르트뢰즈 스위즐 (Chartreuse Swizzle)",
                                        "category": "New Era",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "그린 샤르트뢰즈",
                                                                                "amount": "45ml",
                                                                                "abv": 55
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "팔러넘",
                                                                                "amount": "15ml",
                                                                                "abv": 11
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_073",
                                        "name": "다크 앤 스토미 (Dark ‘N’ Stormy)",
                                        "category": "New Era",
                                        "estimatedAbv": 14,
                                        "ingredients": [
                                                            {
                                                                                "name": "다크 럼",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "진저 비어",
                                                                                "amount": "100ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_074",
                                        "name": "돈스 스페셜 다이키리 (Don’s Special Daiquiri)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "골드 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "패션프루트 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_075",
                                        "name": "에스프레소 마티니 (Espresso Martini)",
                                        "category": "New Era",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "커피 리큐르",
                                                                                "amount": "30ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "에스프레소",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_076",
                                        "name": "페르난디토 (Fernandito)",
                                        "category": "New Era",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "페르넷 브랑카",
                                                                                "amount": "50ml",
                                                                                "abv": 39
                                                            },
                                                            {
                                                                                "name": "콜라",
                                                                                "amount": "120ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_077",
                                        "name": "프렌치 마티니 (French Martini)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라즈베리 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 16
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_078",
                                        "name": "진 바질 스매시 (Gin Basil Smash)",
                                        "category": "New Era",
                                        "estimatedAbv": 27,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "60ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "바질 잎",
                                                                                "amount": "8 leaves",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_079",
                                        "name": "그랜드 마가리타 (Grand Margarita)",
                                        "category": "New Era",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "그랑 마니에르",
                                                                                "amount": "20ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_080",
                                        "name": "IBA 티키 (IBA Tiki)",
                                        "category": "New Era",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "에이지드 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "오버프루프 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 75
                                                            },
                                                            {
                                                                                "name": "패션프루트 퓌레",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "아마레또",
                                                                                "amount": "15ml",
                                                                                "abv": 28
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "꿀 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "팔러넘",
                                                                                "amount": "15ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_081",
                                        "name": "일리걸 (Illegal)",
                                        "category": "New Era",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "메즈칼",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "오버프루프 럼",
                                                                                "amount": "30ml",
                                                                                "abv": 75
                                                            },
                                                            {
                                                                                "name": "마라스키노 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "패션프루트 퓌레",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_082",
                                        "name": "정글 버드 (Jungle Bird)",
                                        "category": "New Era",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "블랙스트랩 럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "캄파리",
                                                                                "amount": "22.5ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "45ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "데메라라 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_083",
                                        "name": "미셔너리즈 다운폴 (Missionary’s Downfall)",
                                        "category": "New Era",
                                        "estimatedAbv": 22,
                                        "ingredients": [
                                                            {
                                                                                "name": "화이트 럼",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "복숭아 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "민트 잎",
                                                                                "amount": "8 leaves",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_084",
                                        "name": "네이키드 앤 페이머스 (Naked and Famous)",
                                        "category": "New Era",
                                        "estimatedAbv": 16,
                                        "ingredients": [
                                                            {
                                                                                "name": "메즈칼",
                                                                                "amount": "22.5ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "옐로 샤르트뢰즈",
                                                                                "amount": "22.5ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "아페롤",
                                                                                "amount": "22.5ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_085",
                                        "name": "뉴욕 사워 (New York Sour)",
                                        "category": "New Era",
                                        "estimatedAbv": 25,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "60ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레드 와인",
                                                                                "amount": "15ml",
                                                                                "abv": 13
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_086",
                                        "name": "올드 쿠반 (Old Cuban)",
                                        "category": "New Era",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "숙성 럼",
                                                                                "amount": "40ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "20ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "민트 잎",
                                                                                "amount": "6 leaves",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "샴페인",
                                                                                "amount": "60ml",
                                                                                "abv": 12
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_087",
                                        "name": "팔로마 (Paloma)",
                                        "category": "New Era",
                                        "estimatedAbv": 17,
                                        "ingredients": [
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "자몽 소다",
                                                                                "amount": "100ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_088",
                                        "name": "페이퍼 플레인 (Paper Plane)",
                                        "category": "New Era",
                                        "estimatedAbv": 17,
                                        "ingredients": [
                                                            {
                                                                                "name": "버번 위스키",
                                                                                "amount": "22.5ml",
                                                                                "abv": 45
                                                            },
                                                            {
                                                                                "name": "아마로 노니노",
                                                                                "amount": "22.5ml",
                                                                                "abv": 32
                                                            },
                                                            {
                                                                                "name": "아페롤",
                                                                                "amount": "22.5ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_089",
                                        "name": "페니실린 (Penicillin)",
                                        "category": "New Era",
                                        "estimatedAbv": 26,
                                        "ingredients": [
                                                            {
                                                                                "name": "블렌디드 스카치",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 진저 시럽",
                                                                                "amount": "22.5ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "아일라 싱글 몰트",
                                                                                "amount": "7.5ml",
                                                                                "abv": 46
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_090",
                                        "name": "피스코 펀치 (Pisco Punch)",
                                        "category": "New Era",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "피스코",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "파인애플 주스",
                                                                                "amount": "90ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_091",
                                        "name": "포르노스타 마티니 (Porn Star Martini)",
                                        "category": "New Era",
                                        "estimatedAbv": 17,
                                        "ingredients": [
                                                            {
                                                                                "name": "바닐라 보드카",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "패션프루트 퓌레",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "바닐라 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "샴페인",
                                                                                "amount": "50ml",
                                                                                "abv": 12
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_092",
                                        "name": "러시안 스프링 펀치 (Russian Spring Punch)",
                                        "category": "New Era",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "25ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "크렘 드 카시스",
                                                                                "amount": "25ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "25ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "스파클링 와인",
                                                                                "amount": "50ml",
                                                                                "abv": 12
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_093",
                                        "name": "셰리 코블러 (Sherry Cobbler)",
                                        "category": "New Era",
                                        "estimatedAbv": 12,
                                        "ingredients": [
                                                            {
                                                                                "name": "셰리 와인",
                                                                                "amount": "90ml",
                                                                                "abv": 17
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "오렌지",
                                                                                "amount": "3 wedges",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_094",
                                        "name": "사우스 사이드 (South Side)",
                                        "category": "New Era",
                                        "estimatedAbv": 24,
                                        "ingredients": [
                                                            {
                                                                                "name": "진",
                                                                                "amount": "60ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "설탕 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "민트 잎",
                                                                                "amount": "6 leaves",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_095",
                                        "name": "스파이시 피프티 (Spicy Fifty)",
                                        "category": "New Era",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "보드카",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "엘더플라워 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 20
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "아가베 시럽",
                                                                                "amount": "10ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레드 칠리",
                                                                                "amount": "2 slices",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_096",
                                        "name": "스프리츠 (Spritz)",
                                        "category": "New Era",
                                        "estimatedAbv": 7,
                                        "ingredients": [
                                                            {
                                                                                "name": "아페롤",
                                                                                "amount": "60ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "프로세코",
                                                                                "amount": "90ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "탄산수",
                                                                                "amount": "splash",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_097",
                                        "name": "서퍼링 바스타드 (Suffering Bastard)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "브랜디",
                                                                                "amount": "30ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "진",
                                                                                "amount": "30ml",
                                                                                "abv": 47
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "진저 비어",
                                                                                "amount": "60ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_098",
                                        "name": "쓰리 닷츠 앤 어 대시 (Three Dots and a Dash)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "럼",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "오렌지 주스",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "팔러넘",
                                                                                "amount": "15ml",
                                                                                "abv": 11
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "1 dash",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_099",
                                        "name": "티퍼러리 (Tipperary)",
                                        "category": "New Era",
                                        "estimatedAbv": 28,
                                        "ingredients": [
                                                            {
                                                                                "name": "아이리시 위스키",
                                                                                "amount": "50ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "스위트 베르무트",
                                                                                "amount": "25ml",
                                                                                "abv": 16
                                                            },
                                                            {
                                                                                "name": "그린 샤르트뢰즈",
                                                                                "amount": "15ml",
                                                                                "abv": 55
                                                            },
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "2 dashes",
                                                                                "abv": 44
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_100",
                                        "name": "토미스 마가리타 (Tommy’s Margarita)",
                                        "category": "New Era",
                                        "estimatedAbv": 27,
                                        "ingredients": [
                                                            {
                                                                                "name": "데킬라",
                                                                                "amount": "60ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "라임즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "아가베 시럽",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_101",
                                        "name": "트리니다드 사워 (Trinidad Sour)",
                                        "category": "New Era",
                                        "estimatedAbv": 20,
                                        "ingredients": [
                                                            {
                                                                                "name": "앙고스투라 비터스",
                                                                                "amount": "45ml",
                                                                                "abv": 44
                                                            },
                                                            {
                                                                                "name": "오르제 시럽",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "30ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "라이 위스키",
                                                                                "amount": "15ml",
                                                                                "abv": 45
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    },
                    {
                                        "id": "iba_102",
                                        "name": "베.엔.토 (Ve.N.To)",
                                        "category": "New Era",
                                        "estimatedAbv": 18,
                                        "ingredients": [
                                                            {
                                                                                "name": "그라파",
                                                                                "amount": "45ml",
                                                                                "abv": 40
                                                            },
                                                            {
                                                                                "name": "레몬즙",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "허니 믹스",
                                                                                "amount": "15ml",
                                                                                "abv": 0
                                                            },
                                                            {
                                                                                "name": "카모마일 리큐르",
                                                                                "amount": "15ml",
                                                                                "abv": 25
                                                            },
                                                            {
                                                                                "name": "스파클링 와인",
                                                                                "amount": "30ml",
                                                                                "abv": 12
                                                            }
                                        ],
                                        "description": "IBA 공식 칵테일 레시피."
                    }
];

                // 공식 IBA 레시피를 변경하지 않고, 사용자가 보유한 재료로 시도할 수 있는 커스텀 대체안만 제안합니다.
                const defaultSubstitutionRules = [
                    { from: '라임즙', to: '레몬즙', note: '시트러스 산미 대체', enabled: false, source: 'default' },
                    { from: '레몬즙', to: '라임즙', note: '시트러스 산미 대체', enabled: false, source: 'default' },
                    { from: '오렌지 주스', to: '자몽 주스', note: '시트러스 주스 계열 대체', enabled: false, source: 'default' },
                    { from: '오렌지 주스', to: '파인애플 주스', note: '트로피컬 계열 대체', enabled: false, source: 'default' },
                    { from: '파인애플 주스', to: '오렌지 주스', note: '트로피컬 주스 대체', enabled: false, source: 'default' },
                    { from: '설탕 시럽', to: '꿀 시럽', note: '단맛 시럽 대체', enabled: false, source: 'default' },
                    { from: '설탕 시럽', to: '아가베 시럽', note: '단맛 시럽 대체', enabled: false, source: 'default' },
                    { from: '그레나딘 시럽', to: '라즈베리 시럽', note: '붉은 과실 시럽 대체', enabled: false, source: 'default' },
                    { from: '탄산수', to: '스파클링 워터', note: '무가당 탄산수 대체', enabled: false, source: 'default' },
                    { from: '탄산수', to: '소다수', note: '무가당 탄산수 대체', enabled: false, source: 'default' },
                    { from: '토닉워터', to: '탄산수', note: '탄산 베이스 대체', enabled: false, source: 'default' },
                    { from: '진저비어', to: '진저에일', note: '생강 탄산음료 대체', enabled: false, source: 'default' },
                    { from: '생크림', to: '휘핑크림', note: '크림류 대체', enabled: false, source: 'default' },
                    { from: '계란흰자', to: '아쿠아파바', note: '폼 형성 재료 대체', enabled: false, source: 'default' }
                ];
                const substitutionRules = ref(defaultSubstitutionRules.map(rule => ({ ...rule, enabled: false })));

                const normalizeSubstitutionRule = (rule) => ({
                    from: String(rule?.from || '').trim(),
                    to: String(rule?.to || '').trim(),
                    note: String(rule?.note || '').trim(),
                    enabled: rule?.enabled !== false,
                    source: rule?.source || 'custom'
                });

                const filteredSubstitutionRules = computed(() => {
                    const q = substitutionSearch.value.trim().toLowerCase();
                    if (!q) return substitutionRules.value;
                    return substitutionRules.value.filter(rule =>
                        rule.from.toLowerCase().includes(q) || rule.to.toLowerCase().includes(q) || rule.note.toLowerCase().includes(q)
                    );
                });

                const resetSubstitutionForm = () => {
                    Object.assign(substitutionForm, { from: '', to: '', note: '' });
                    editingSubstitutionIndex.value = null;
                };

                const openSubstitutionEditor = (rule = null) => {
                    if (rule) {
                        editingSubstitutionIndex.value = substitutionRules.value.indexOf(rule);
                        Object.assign(substitutionForm, { from: rule.from, to: rule.to, note: rule.note });
                    } else resetSubstitutionForm();
                };

                const saveSubstitutionRule = () => {
                    const from = substitutionForm.from.trim();
                    const to = substitutionForm.to.trim();
                    if (!from || !to) return triggerToast('원재료와 대체 재료를 모두 입력해주세요.', 'error');
                    if (ingredientNamesMatch(from, to)) return triggerToast('동일한 재료끼리는 대체 규칙으로 등록할 수 없습니다.', 'error');
                    const duplicate = substitutionRules.value.find((rule, index) => index !== editingSubstitutionIndex.value && ingredientNamesMatch(rule.from, from) && ingredientNamesMatch(rule.to, to));
                    if (duplicate) return triggerToast('이미 등록된 대체 규칙입니다.', 'error');
                    const next = normalizeSubstitutionRule({ from, to, note: substitutionForm.note, enabled: true, source: 'custom' });
                    if (editingSubstitutionIndex.value !== null) substitutionRules.value.splice(editingSubstitutionIndex.value, 1, next);
                    else substitutionRules.value.push(next);
                    resetSubstitutionForm();
                    triggerToast('대체 재료 설정을 저장했습니다.');
                };

                const toggleSubstitutionRule = (rule) => {
                    rule.enabled = !rule.enabled;
                    triggerToast(rule.enabled ? '대체 규칙을 활성화했습니다.' : '대체 규칙을 비활성화했습니다.');
                };

                const deleteSubstitutionRule = (rule) => {
                    const index = substitutionRules.value.indexOf(rule);
                    if (index >= 0) substitutionRules.value.splice(index, 1);
                    triggerToast('대체 규칙을 삭제했습니다.');
                };

                const restoreDefaultSubstitutions = () => {
                    substitutionRules.value = defaultSubstitutionRules.map(rule => ({ ...rule, enabled: false }));
                    resetSubstitutionForm();
                    triggerToast('기본 대체 규칙을 복원했습니다.');
                };


                const normalizeCustomCellarItem = (item, index = 0) => ({
                    id: String(item?.id || `personal_cellar_${Date.now()}_${index}`),
                    name: String(item?.name || '').trim(),
                    brand: String(item?.brand || '').trim(),
                    category: String(item?.category || '기타'),
                    abv: Number(item?.abv || 0),
                    image: String(item?.image || '').trim(),
                    status: 'owned'
                });

                const resetCustomCellarForm = () => Object.assign(customCellarForm, { name: '', brand: '', category: '위스키', abv: 40, image: '' });
                const openCustomCellarModalFn = () => { resetCustomCellarForm(); showCustomCellarModal.value = true; };
                const closeCustomCellarModal = () => { showCustomCellarModal.value = false; resetCustomCellarForm(); };
                const saveCustomCellarItem = () => {
                    const name = customCellarForm.name.trim();
                    if (!name) return triggerToast('술 이름을 입력해주세요.', 'error');
                    const duplicate = customCellar.value.some(item => normalizeIngredientName(item.name) === normalizeIngredientName(name) && normalizeIngredientName(item.brand || '') === normalizeIngredientName(customCellarForm.brand || ''));
                    if (duplicate) return triggerToast('이미 내 술장에 같은 술이 등록되어 있습니다.', 'error');
                    customCellar.value.unshift(normalizeCustomCellarItem({ id: `personal_cellar_${Date.now()}`, name, brand: customCellarForm.brand, category: customCellarForm.category, abv: customCellarForm.abv, image: customCellarForm.image }));
                    scheduleUserSync();
                    closeCustomCellarModal();
                    triggerToast(`'${name}'을(를) 내 술장에 추가했습니다.`);
                };
                const removeCustomCellarItem = (item) => {
                    openConfirmModal('개인 술 삭제', `'${item.name}'을(를) 내 술장에서 삭제할까요?`, () => {
                        customCellar.value = customCellar.value.filter(x => x.id !== item.id);
                        scheduleUserSync();
                        triggerToast('개인 술장에서 삭제했습니다.');
                    });
                };

                // Firebase Cloud 데이터 복원 / 저장
                const safeParseStorage = (key, fallback) => {
                    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) ?? fallback) : fallback; }
                    catch (_) { return fallback; }
                };

                const normalizeStoredIngredient = (ing, index) => ({
                    id: ing.id || `na_migrated_${Date.now()}_${index}`,
                    name: String(ing.name || '').trim(), category: ing.category || '비터스/기타',
                    owned: Boolean(ing.owned), description: ing.description || '', abv: Number(ing.abv || 0)
                });

                const hydrateFromCloud = async () => {
                    if (!firebaseDb || !currentUser.value || !hasServiceAccess.value) return;
                    const uid = currentUser.value.uid;
                    const catalogSnap = await firebaseDb.collection('catalog').get();
                    if (!catalogSnap.empty) {
                        catalog.value = catalogSnap.docs.map(doc => ({ id: doc.id, ...doc.data(), status: 'none' }));
                    } else if (isAdmin.value) {
                        catalog.value = [...catalog.value];
                        await syncCatalogToCloud();
                    }

                    const userDoc = await firebaseDb.collection('users').doc(uid).collection('data').doc('main').get();
                    const local = userDoc.exists ? (userDoc.data() || {}) : {};
                    const cellar = local.cellar || {};
                    catalog.value.forEach(item => { item.status = cellar[item.id] || 'none'; });
                    if (Array.isArray(local.customCellar)) customCellar.value = local.customCellar.map(normalizeCustomCellarItem).filter(x => x.name);
                    if (Array.isArray(local.nonAlcoholic)) defaultNonAlcoholicIngredients.value = local.nonAlcoholic.map(normalizeStoredIngredient).filter(x => x.name);
                    if (Array.isArray(local.recipes)) recipes.value = local.recipes;
                    if (Array.isArray(local.substitutions)) substitutionRules.value = local.substitutions.map(normalizeSubstitutionRule).filter(x => x.from && x.to);
                    if (local.ibaMeta && typeof local.ibaMeta === 'object') Object.assign(ibaMeta, local.ibaMeta);

                    // 최초 로그인 사용자는 기존 localStorage 데이터를 1회 마이그레이션합니다.
                    if (!userDoc.exists) {
                        const oldCatalog = safeParseStorage('hbs_catalog', null);
                        const oldCustomCellar = safeParseStorage('hbs_custom_cellar', null);
                        const oldNa = safeParseStorage('hbs_na_ingredients', null);
                        const oldRecipes = safeParseStorage('hbs_recipes', null);
                        const oldSubs = safeParseStorage('hbs_substitutions', null);
                        const oldMeta = safeParseStorage('hbs_iba_meta', null);
                        if (Array.isArray(oldCatalog)) catalog.value.forEach(item => { const found = oldCatalog.find(x => x.id === item.id); if (found?.status) item.status = found.status; });
                        if (Array.isArray(oldCustomCellar)) customCellar.value = oldCustomCellar.map(normalizeCustomCellarItem).filter(x => x.name);
                        if (Array.isArray(oldNa)) defaultNonAlcoholicIngredients.value = oldNa.map(normalizeStoredIngredient).filter(x => x.name);
                        if (Array.isArray(oldRecipes)) recipes.value = oldRecipes;
                        if (Array.isArray(oldSubs)) substitutionRules.value = oldSubs.map(normalizeSubstitutionRule).filter(x => x.from && x.to);
                        if (oldMeta && typeof oldMeta === 'object') Object.assign(ibaMeta, oldMeta);
                        await syncUserState();
                    }
                    cloudHydrated = true;
                    if (isAdmin.value) await syncCatalogToCloud();
                };

                const syncUserState = async () => {
                    if (!firebaseDb || !currentUser.value || !cloudHydrated) return;
                    const uid = currentUser.value.uid;
                    const cellar = {};
                    catalog.value.forEach(item => { if (item.status && item.status !== 'none') cellar[item.id] = item.status; });
                    await firebaseDb.collection('users').doc(uid).collection('data').doc('main').set({
                        cellar, customCellar: customCellar.value, nonAlcoholic: defaultNonAlcoholicIngredients.value, recipes: recipes.value,
                        substitutions: substitutionRules.value, ibaMeta: JSON.parse(JSON.stringify(ibaMeta)),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                };

                const scheduleUserSync = () => {
                    if (!cloudHydrated || !currentUser.value) return;
                    clearTimeout(userSyncTimer);
                    userSyncTimer = setTimeout(() => syncUserState().catch(err => console.error('[HBS] user sync', err)), 500);
                };

                const syncCatalogToCloud = async () => {
                    if (!firebaseDb || !isAdmin.value || !cloudHydrated) return;
                    const existing = await firebaseDb.collection('catalog').get();
                    const currentIds = new Set(catalog.value.map(item => String(item.id)));
                    const batch = firebaseDb.batch();
                    existing.docs.forEach(doc => { if (!currentIds.has(doc.id)) batch.delete(doc.ref); });
                    catalog.value.forEach(item => {
                        const ref = firebaseDb.collection('catalog').doc(String(item.id));
                        const payload = { ...item }; delete payload.status;
                        batch.set(ref, payload, { merge: true });
                    });
                    await batch.commit();
                };

                const scheduleCatalogSync = () => {
                    if (!isAdmin.value || !cloudHydrated) return;
                    clearTimeout(catalogSyncTimer);
                    catalogSyncTimer = setTimeout(() => syncCatalogToCloud().catch(err => console.error('[HBS] catalog sync', err)), 700);
                };

                onMounted(() => {
                    // 초기 UI는 기존 로컬 데이터로 즉시 표시하고, 로그인 후 Firebase 데이터가 우선합니다.
                    const savedCatalog = safeParseStorage('hbs_catalog', null);
                    if (Array.isArray(savedCatalog)) {
                        const restored = savedCatalog.map(item => ({ ...item, name: String(item.name || '').trim(), brand: String(item.brand || '').trim(), status: item.status || 'none' }));
                        catalog.value = restored.concat(defaultCatalogSeed.filter(seed => !restored.some(item => item.id === seed.id)));
                    }
                    const savedCustomCellar = safeParseStorage('hbs_custom_cellar', null);
                    if (Array.isArray(savedCustomCellar)) customCellar.value = savedCustomCellar.map(normalizeCustomCellarItem).filter(x => x.name);
                    const savedNa = safeParseStorage('hbs_na_ingredients', null);
                    if (Array.isArray(savedNa)) defaultNonAlcoholicIngredients.value = savedNa.map(normalizeStoredIngredient).filter(x => x.name);
                    const savedRecipes = safeParseStorage('hbs_recipes', null);
                    if (Array.isArray(savedRecipes)) recipes.value = savedRecipes;
                    const savedSubs = safeParseStorage('hbs_substitutions', null);
                    if (Array.isArray(savedSubs)) substitutionRules.value = savedSubs.map(normalizeSubstitutionRule).filter(x => x.from && x.to);
                    const savedMeta = safeParseStorage('hbs_iba_meta', null);
                    if (savedMeta && typeof savedMeta === 'object') Object.assign(ibaMeta, savedMeta);
                    defaultNonAlcoholicIngredients.value.forEach((ing, index) => { if (!ing.id) ing.id = `na_${index+1}`; if (typeof ing.owned !== 'boolean') ing.owned = false; });
                    setInterval(() => { nowTick.value = Date.now(); }, 1000);
                    initializeFirebase();
                    clearInterval(accessCheckTimer);
                    accessCheckTimer = setInterval(() => { if (firebaseAuth?.currentUser) loadAccessStatus().catch(() => {}); }, 60000);
                });

                watch(catalog, () => {
                    if (!cloudHydrated) return;
                    scheduleUserSync();
                    scheduleCatalogSync();
                }, { deep: true });
                watch(customCellar, scheduleUserSync, { deep: true });
                watch(defaultNonAlcoholicIngredients, scheduleUserSync, { deep: true });
                watch(recipes, scheduleUserSync, { deep: true });
                watch(ibaMeta, scheduleUserSync, { deep: true });
                watch(substitutionRules, scheduleUserSync, { deep: true });

                const getTabTitle = () => {
                    switch (currentTab.value) {
                        case 'home': return '홈';
                        case 'catalog': return '카탈로그 (Catalog)';
                        case 'cellar': return '내 술장 (Cellar)';
                        case 'nonAlcoholic': return '칵테일 재료 (Ingredients)';
                        case 'substitutions': return '재료 대체 설정 (Substitutions)';
                        case 'ibaDirectory': return 'IBA 공식 도감';
                        case 'recommend': return 'IBA 스마트 추천';
                        case 'recipe': return '내 레시피 & 시음록';
                        case 'chat': return '유저 채팅';
                        case 'profile': return '내 프로필';
                        case 'admin': return '관리자 센터';
                        default: return '홈';
                    }
                };

                // 필터링 계산
                const wishlistCatalog = computed(() => catalog.value.filter(item => item.status === 'wish'));

                const filteredCatalog = computed(() => {
                    return catalog.value.filter(item => {
                        // 위시리스트 보기는 카테고리와 독립: 위시리스트 ON이면 전체 카테고리의 위시 항목을 보여줍니다.
                        const matchCat = catalogWishlistOnly.value || selectedCategory.value === '전체' || item.category === selectedCategory.value;
                        const matchSearch = item.name.toLowerCase().includes(catalogSearch.value.toLowerCase()) || item.brand.toLowerCase().includes(catalogSearch.value.toLowerCase());
                        const matchWishlist = !catalogWishlistOnly.value || item.status === 'wish';
                        return matchCat && matchSearch && matchWishlist;
                    });
                });

                const ownedCatalog = computed(() => catalog.value.filter(item => item.status === 'owned'));

                const filteredNonAlcoholicIngredients = computed(() => {
                    return defaultNonAlcoholicIngredients.value.filter(ing => {
                        const matchCat = selectedNaCategory.value === '전체' || ing.category === selectedNaCategory.value;
                        const matchSearch = ing.name.toLowerCase().includes(nonAlcoholicSearch.value.toLowerCase());
                        return matchCat && matchSearch;
                    });
                });

                // IBA 재료명 정규화/동의어 처리
                // 표기 차이(주스/즙, tonic water/토닉워터 등)가 있어도 같은 재료로 인식합니다.
                const normalizeIngredientName = (name) => {
                    return String(name || '')
                        .toLowerCase()
                        .normalize('NFKC')
                        .replace(/[\s·・_\-–—/]+/g, '')
                        .replace(/[()\[\]{}.,'’“”":]/g, '');
                };

                const ingredientAliases = {
                    '라임즙': ['라임주스', 'limejuice', 'lime'],
                    '레몬즙': ['레몬주스', 'lemonjuice', 'lemon'],
                    '오렌지주스': ['orangejuice', 'orange'],
                    '파인애플주스': ['pineapplejuice', 'pineapple'],
                    '설탕시럽': ['심플시럽', 'simplesyrup', 'sugarsyrup'],
                    '그레나딘시럽': ['grenadine', 'grenadinesyrup'],
                    '민트잎': ['민트', 'mintleaves', 'mint'],
                    '탄산수': ['소다수', 'sodawater', 'clubsoda', 'sparklingwater'],
                    '콜라': ['coke', 'cola'],
                    '진저비어': ['gingerbeer'],
                    '토닉워터': ['tonicwater', 'tonic'],
                    '앙고스투라비터스': ['angosturabitters', 'angostura'],
                    '생크림': ['휘핑크림', 'heavycream', 'whippingcream', 'cream'],
                    '계란흰자': ['에그화이트', 'eggwhite', 'eggwhites']
                };

                const getIngredientVariants = (name) => {
                    const normalized = normalizeIngredientName(name);
                    const variants = new Set([normalized]);

                    Object.entries(ingredientAliases).forEach(([canonical, aliases]) => {
                        const group = [canonical, ...aliases].map(normalizeIngredientName);
                        if (group.includes(normalized)) group.forEach(v => variants.add(v));
                    });

                    return [...variants].filter(Boolean);
                };

                const ingredientNamesMatch = (a, b) => {
                    const aVariants = getIngredientVariants(a);
                    const bVariants = getIngredientVariants(b);
                    return aVariants.some(av => bVariants.includes(av));
                };

                // 주류 계열 재료는 세부 제품명과 IBA의 일반 재료명을 연결합니다.
                // 예: '드라이 진'을 보유하고 있으면 IBA의 '진' 요구도 충족합니다.
                const spiritCategoryByIngredient = {
                    '진': '진',
                    '위스키': '위스키',
                    '보드카': '보드카',
                    '럼': '럼',
                    '데킬라': '데킬라',
                    '브랜디': '브랜디',
                    '리큐르': '리큐르',
                    '비터스': '비터스'
                };

                const ingredientMatchesCatalogItem = (item, ingName) => {
                    if (!item || !ingName) return false;
                    if (ingredientNamesMatch(item.name, ingName)) return true;

                    const requested = normalizeIngredientName(ingName);
                    const category = String(item.category || '').trim();
                    return spiritCategoryByIngredient[requested] === category;
                };

                // 실제 보유 여부 판별 (대체 규칙은 아직 적용하지 않음)
                const isDirectIngredientOwned = (ingName) => {
                    if (!ingName) return false;

                    const foundInCatalog = catalog.value.some(item =>
                        item.status === 'owned' && ingredientMatchesCatalogItem(item, ingName)
                    );
                    if (foundInCatalog) return true;

                    const foundInPersonalCellar = customCellar.value.some(item =>
                        item.status === 'owned' && ingredientMatchesCatalogItem(item, ingName)
                    );
                    if (foundInPersonalCellar) return true;

                    return defaultNonAlcoholicIngredients.value.some(ing =>
                        ing.owned && ingredientNamesMatch(ing.name, ingName)
                    );
                };

                // IBA 공식 레시피의 보유 현황 판별
                // 1) 원재료를 직접 보유하면 체크
                // 2) 직접 보유하지 않았더라도 활성화된 대체 규칙의 '대체 재료'를 보유하면 체크
                //    → IBA 공식 레시피의 체크/추천/1개 부족 계산에 동일하게 반영합니다.
                // 대체 규칙은 한 단계만 적용하여 A→B→C 연쇄 및 순환 참조로 인한 무한 재귀를 방지합니다.
                const isIngredientOwned = (ingName) => {
                    if (!ingName) return false;
                    if (isDirectIngredientOwned(ingName)) return true;

                    const substitutionTargets = substitutionRules.value
                        .filter(rule => rule.enabled && ingredientNamesMatch(rule.from, ingName))
                        .map(rule => rule.to)
                        .filter((to, index, arr) =>
                            arr.findIndex(item => ingredientNamesMatch(item, to)) === index
                        );

                    return substitutionTargets.some(target => isDirectIngredientOwned(target));
                };

                // IBA 공식 재료가 대체 규칙을 통해 충족되었는지 표시합니다.
                // 실제 보유 재료만 대상으로 하며, 대체 규칙은 한 단계까지만 적용합니다.
                const getAppliedSubstitutions = (ingredientName) => {
                    if (!ingredientName || isDirectIngredientOwned(ingredientName)) return [];

                    const applied = [];
                    substitutionRules.value.forEach(rule => {
                        if (!rule.enabled || !ingredientNamesMatch(rule.from, ingredientName)) return;
                        if (!isDirectIngredientOwned(rule.to)) return;
                        if (applied.some(item => ingredientNamesMatch(item.to, rule.to))) return;
                        applied.push({ from: ingredientName, to: rule.to, note: rule.note || '' });
                    });
                    return applied;
                };

                const isIngredientSubstituted = (ingredientName) =>
                    getAppliedSubstitutions(ingredientName).length > 0;

                // 기타 재료 보유 상태 토글
                const toggleIngredientOwned = (ing) => {
                    ing.owned = !ing.owned;
                    scheduleUserSync();
                    triggerToast(`${ing.name} 보유 상태가 ${ing.owned ? '보유중' : '미보유'}로 변경되었습니다.`);
                };

                const openCustomIngredientModal = () => {
                    naForm.name = '';
                    naForm.category = '주스';
                    naForm.description = '';
                    openNaIngredientModal.value = true;
                };

                const saveCustomNaIngredient = () => {
                    const name = naForm.name.trim();
                    if (!name) return triggerToast('재료 이름을 입력해주세요.', 'error');

                    const duplicated = defaultNonAlcoholicIngredients.value.some(
                        ing => ingredientNamesMatch(ing.name, name)
                    );
                    if (duplicated) {
                        return triggerToast('이미 등록된 재료와 동일하거나 유사한 이름입니다.', 'error');
                    }

                    defaultNonAlcoholicIngredients.value.unshift({
                        id: 'na_custom_' + Date.now(),
                        name,
                        category: naForm.category,
                        owned: true,
                        description: naForm.description.trim(),
                        abv: 0
                    });
                    openNaIngredientModal.value = false;
                    scheduleUserSync();
                    triggerToast('새 커스텀 재료가 등록되었습니다.');
                };

                const getCategoryIcon = (cat) => {
                    switch (cat) {
                        case '주스': return 'fa-solid fa-whiskey-glass';
                        case '시럽': return 'fa-solid fa-bottle-droplet';
                        case '즙/과일': return 'fa-solid fa-lemon';
                        case '허브/잎': return 'fa-solid fa-leaf';
                        case '탄산/음료': return 'fa-solid fa-glass-water';
                        default: return 'fa-solid fa-cube';
                    }
                };

                // IBA 추천 엔진
                // 내 레시피로 등록한 IBA는 추천에서 제외하고, 즐겨찾기/시음/대체 재료 기록은 별도 메타로 관리합니다.
                const normalizeRecipeName = (name = '') => normalizeIngredientName(name);

                const getIbaMeta = (iba) => {
                    if (!iba || !iba.id) return {};
                    if (!ibaMeta[iba.id]) ibaMeta[iba.id] = { favorite: false, tasted: false };
                    return ibaMeta[iba.id];
                };

                const isIbaFavorite = (iba) => Boolean(getIbaMeta(iba).favorite);
                const isIbaTasted = (iba) => Boolean(getIbaMeta(iba).tasted);

                const toggleIbaFavorite = (iba) => {
                    const meta = getIbaMeta(iba);
                    meta.favorite = !meta.favorite;
                    triggerToast(meta.favorite ? `'${iba.name}'을(를) 즐겨찾기에 추가했습니다.` : `'${iba.name}' 즐겨찾기를 해제했습니다.`);
                };

                const toggleIbaTasted = (iba) => {
                    const meta = getIbaMeta(iba);
                    meta.tasted = !meta.tasted;
                    triggerToast(meta.tasted ? `'${iba.name}'을(를) 마셔본 칵테일로 기록했습니다.` : `'${iba.name}' 시음 기록을 해제했습니다.`);
                };

                const openIbaDetail = (iba) => {
                    if (!iba) return;
                    selectedIbaDetail.value = iba;
                    showIbaDetailModal.value = true;
                };

                const closeIbaDetail = () => {
                    showIbaDetailModal.value = false;
                    selectedIbaDetail.value = null;
                };

                const getIbaDetailMissing = (iba) => {
                    if (!iba?.ingredients) return [];
                    return iba.ingredients.filter(ing => !isIngredientOwned(ing.name));
                };

                const getIbaDetailOwnedCount = (iba) => {
                    if (!iba?.ingredients) return 0;
                    return iba.ingredients.filter(ing => isIngredientOwned(ing.name)).length;
                };

                const getIbaDetailProgress = (iba) => {
                    if (!iba?.ingredients?.length) return 0;
                    return Math.round((getIbaDetailOwnedCount(iba) / iba.ingredients.length) * 100);
                };

                const isIbaRecipeSaved = (iba) => {
                    const ibaId = String(iba?.id || '');
                    const ibaName = normalizeRecipeName(iba?.name);
                    return recipes.value.some(saved => {
                        if (!saved) return false;
                        if (saved.ibaId && ibaId && String(saved.ibaId) === ibaId) return true;
                        return saved.source === 'IBA' && normalizeRecipeName(saved.name) === ibaName;
                    });
                };

                const readyIbaRecipes = computed(() => {
                    return ibaOfficialDatabase.filter(recipe =>
                        !isIbaRecipeSaved(recipe) &&
                        recipe.ingredients.every(ing => isIngredientOwned(ing.name))
                    );
                });

                const almostIbaRecipes = computed(() => {
                    const list = [];
                    ibaOfficialDatabase.forEach(recipe => {
                        if (isIbaRecipeSaved(recipe)) return;
                        const missing = recipe.ingredients.filter(ing => !isIngredientOwned(ing.name));
                        if (missing.length === 1) {
                            list.push({ recipe, missing: [missing[0].name], alternatives: getAlternativeIngredients(missing[0].name) });
                        }
                    });
                    return list;
                });

                const oneIngredientUnlocks = computed(() => {
                    const groups = new Map();
                    almostIbaRecipes.value.forEach(item => {
                        const name = item.missing[0];
                        const key = normalizeIngredientName(name);
                        if (!groups.has(key)) groups.set(key, { name, count: 0, recipes: [] });
                        const group = groups.get(key);
                        group.count += 1;
                        group.recipes.push(item.recipe);
                    });
                    return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
                });

                const getAlternativeIngredients = (missingName) => {
                    return substitutionRules.value
                        .filter(rule => rule.enabled && ingredientNamesMatch(rule.from, missingName))
                        .map(rule => rule.to)
                        .filter((alt, index, arr) => arr.findIndex(x => ingredientNamesMatch(x, alt)) === index)
                        .filter(alt => isDirectIngredientOwned(alt));
                };

const favoriteIbaRecipesCount = computed(() => ibaOfficialDatabase.filter(iba => isIbaFavorite(iba)).length);
                const tastedIbaRecipesCount = computed(() => ibaOfficialDatabase.filter(iba => isIbaTasted(iba)).length);

                const filteredIbaDirectory = computed(() => {
                    return ibaOfficialDatabase.filter(iba => {
                        const matchCat = ibaCategory.value === '전체' || iba.category === ibaCategory.value;
                        const query = ibaSearch.value.trim().toLowerCase();
                        const matchSearch = !query || iba.name.toLowerCase().includes(query) || iba.ingredients.some(i => i.name.toLowerCase().includes(query));
                        const matchStatus = ibaStatusFilter.value === '전체' ||
                            (ibaStatusFilter.value === '즐겨찾기' && isIbaFavorite(iba)) ||
                            (ibaStatusFilter.value === '마셔봄' && isIbaTasted(iba)) ||
                            (ibaStatusFilter.value === '미시음' && !isIbaTasted(iba));
                        return matchCat && matchSearch && matchStatus;
                    });
                });

                // 카탈로그 CRUD
                const setStatus = (item, status) => {
                    const nextStatus = item.status === status ? 'none' : status;
                    item.status = nextStatus;
                    scheduleUserSync();
                    if (status === 'owned') triggerToast(nextStatus === 'owned' ? `'${item.name}'을(를) 보유로 표시했습니다.` : `'${item.name}' 보유를 해제했습니다.`);
                    if (status === 'wish') triggerToast(nextStatus === 'wish' ? `'${item.name}'을(를) 위시에 추가했습니다.` : `'${item.name}' 위시를 해제했습니다.`);
                };
                const openModalForAdd = () => {
                    editingItem.value = null;
                    imageSearchResults.value = [];
                    Object.assign(itemForm, { name: '', brand: '', category: '위스키', abv: 40, status: 'owned', image: '', imageSource: '', imageSourcePage: '' });
                    openItemModal.value = true;
                };
                const editItem = (item) => {
                    editingItem.value = item;
                    imageSearchResults.value = [];
                    Object.assign(itemForm, { imageSource: '', imageSourcePage: '', ...item });
                    openItemModal.value = true;
                };

                const buildAlcoholImageQueries = () => {
                    const brand = String(itemForm.brand || '').trim();
                    const name = String(itemForm.name || '').trim();
                    const queries = [
                        `${brand} ${name} bottle`,
                        `${brand} ${name}`,
                        `${name} bottle`,
                        `${brand} product bottle`,
                        `${name} product`
                    ].map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
                    return [...new Set(queries)];
                };

                const getImageSearchText = (result) => {
                    return `${result.title || ''} ${result.description || ''}`.toLowerCase();
                };

                const scoreAlcoholImageResult = (result) => {
                    const text = getImageSearchText(result);
                    const queryText = `${itemForm.brand || ''} ${itemForm.name || ''}`.toLowerCase();
                    const tokens = queryText.split(/[^a-z0-9가-힣]+/i).filter(t => t.length >= 2);
                    let score = 0;
                    tokens.forEach(token => { if (text.includes(token)) score += 12; });
                    if (/\b(bottle|product|packshot|spirit|whisky|whiskey|gin|vodka|rum|tequila|liqueur|brandy|cognac|vermouth)\b/i.test(text)) score += 24;
                    if (/\b(label|logo|advert|poster|cocktail|bar|person|people|glass|drink|event|menu)\b/i.test(text)) score -= 28;
                    if (/\.(svg|gif)$/i.test(result.title)) score -= 30;
                    if (/\b(bottle|product)\b/i.test(text)) score += 10;
                    return score;
                };

                const estimateWhiteBackgroundScore = (url) => new Promise(resolve => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => {
                        try {
                            const size = 72;
                            const canvas = document.createElement('canvas');
                            canvas.width = canvas.height = size;
                            const ctx = canvas.getContext('2d', { willReadFrequently: true });
                            ctx.drawImage(img, 0, 0, size, size);
                            const data = ctx.getImageData(0, 0, size, size).data;
                            const patch = 14;
                            let white = 0, samples = 0;
                            const points = [[0,0],[size-patch,0],[0,size-patch],[size-patch,size-patch]];
                            points.forEach(([sx,sy]) => {
                                for (let y=sy; y<sy+patch; y++) for (let x=sx; x<sx+patch; x++) {
                                    const i=(y*size+x)*4;
                                    const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
                                    if (a > 220 && r > 220 && g > 220 && b > 220) white++;
                                    samples++;
                                }
                            });
                            resolve(Math.round((white / samples) * 45));
                        } catch (_) { resolve(0); }
                    };
                    img.onerror = () => resolve(0);
                    img.src = url;
                });

                const fetchAlcoholImageCandidates = async () => {
                    if (!itemForm.name.trim()) return [];
                    const queries = buildAlcoholImageQueries();
                    const all = [];
                    for (const query of queries) {
                        try {
                            const params = new URLSearchParams({
                                action: 'query', generator: 'search', gsrsearch: query, gsrnamespace: '6',
                                gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '700', format: 'json', origin: '*'
                            });
                            const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
                            if (!response.ok) continue;
                            const data = await response.json();
                            all.push(...Object.values(data.query?.pages || {}).map(page => {
                                const info = page.imageinfo?.[0] || {};
                                const meta = info.extmetadata || {};
                                return {
                                    title: String(page.title || '').replace(/^File:/i, ''),
                                    thumbUrl: info.thumburl || info.url || '',
                                    imageUrl: info.url || info.thumburl || '',
                                    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || '')}`,
                                    description: String(meta.ImageDescription?.value || ''),
                                    license: String(meta.LicenseShortName?.value || ''),
                                    score: 0
                                };
                            }));
                        } catch (_) {}
                    }
                    const seen = new Set();
                    return all.filter(x => {
                        if (!x.thumbUrl || !x.imageUrl || !/^https?:\/\//i.test(x.thumbUrl)) return false;
                        if (seen.has(x.pageUrl)) return false;
                        seen.add(x.pageUrl);
                        return /\.(jpe?g|png|webp)(\?|$)/i.test(x.thumbUrl);
                    });
                };

                const openGoogleImageSearch = () => {
                    const brand = String(itemForm.brand || '').trim();
                    const name = String(itemForm.name || '').trim();
                    if (!name && !brand) return triggerToast('먼저 브랜드 또는 제품명을 입력하세요.', 'error');
                    const query = [brand, name, 'bottle', 'product', 'white background'].filter(Boolean).join(' ');
                    const url = `https://www.google.com/search?tbm=isch&hl=ko&q=${encodeURIComponent(query)}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                    triggerToast('Google 이미지 검색을 새 탭에서 열었습니다. 원하는 이미지를 선택해 주세요.');
                };

                const searchAlcoholProductImage = async () => {
                    if (!itemForm.name.trim()) return triggerToast('먼저 제품명을 입력하세요.', 'error');
                    imageSearchLoading.value = true;
                    imageSearchResults.value = [];
                    try {
                        const candidates = await fetchAlcoholImageCandidates();
                        const scored = await Promise.all(candidates.map(async result => ({
                            ...result, score: scoreAlcoholImageResult(result) + await estimateWhiteBackgroundScore(result.thumbUrl)
                        })));
                        imageSearchResults.value = scored
                            .sort((a,b) => b.score - a.score)
                            .slice(0, 9);
                        if (!imageSearchResults.value.length) throw new Error('검색 결과가 없습니다.');
                        triggerToast(`${imageSearchResults.value.length}개의 이미지 후보를 찾았습니다. 원하는 이미지를 클릭하세요.`);
                    } catch (error) {
                        console.error(error);
                        triggerToast('이미지를 자동으로 찾지 못했습니다. 직접 업로드하거나 URL을 입력해주세요.', 'error');
                    } finally { imageSearchLoading.value = false; }
                };

                const selectAlcoholImage = (result) => {
                    itemForm.image = result.imageUrl || result.thumbUrl;
                    itemForm.imageSource = result.license ? `Wikimedia Commons · ${result.license}` : 'Wikimedia Commons';
                    itemForm.imageSourcePage = result.pageUrl;
                };

                const closeItemModal = () => { imageSearchResults.value = []; openItemModal.value = false; };
                const saveItem = async () => {
                    if (!isAdmin.value) return triggerToast('전체 도감 등록/수정은 관리자만 가능합니다.', 'error');
                    if (!itemForm.name) return triggerToast('제품명을 입력하세요.', 'error');
                    if (editingItem.value) {
                        Object.assign(editingItem.value, itemForm);
                    } else {
                        catalog.value.push({ id: 'c_' + Date.now(), ...itemForm });
                    }
                    closeItemModal();
                    triggerToast('주류 정보가 저장되었습니다.');
                };

                const askDeleteCatalogItem = (item) => {
                    if (!isAdmin.value) return triggerToast('전체 도감 삭제는 관리자만 가능합니다.', 'error');
                    openConfirmModal('주류 삭제', `'${item.name}' 항목을 정말 삭제하시겠습니까?`, () => {
                        catalog.value = catalog.value.filter(c => c.id !== item.id);
                        triggerToast('삭제되었습니다.');
                    });
                };

                // 레시피 피커 및 도수 계산
                const filteredPickerCatalog = computed(() => {
                    return catalog.value.filter(c => c.name.toLowerCase().includes(pickerSearch.value.toLowerCase()));
                });
                const filteredPickerNonAlc = computed(() => {
                    const query = pickerSearch.value.trim().toLowerCase();
                    if (!query) return defaultNonAlcoholicIngredients.value;
                    return defaultNonAlcoholicIngredients.value.filter(n =>
                        n.name.toLowerCase().includes(query) ||
                        normalizeIngredientName(n.name).includes(normalizeIngredientName(query))
                    );
                });

                const openIngredientPicker = () => {
                    pickerSearch.value = '';
                    selectedIngredientName.value = '';
                    customIngredientName.value = '';
                    openIngredientPickerModal.value = true;
                };

                const selectCatalogIngredient = (item) => {
                    selectedIngredientName.value = item.name;
                    selectedIngredientAbv.value = item.abv || 0;
                };
                const selectNaIngredient = (item) => {
                    selectedIngredientName.value = item.name;
                    selectedIngredientAbv.value = Number(item.abv || 0);
                };

                const getTargetIngredientName = () => {
                    if (pickerTab.value === 'custom') return customIngredientName.value;
                    return selectedIngredientName.value;
                };

                const confirmAddIngredient = () => {
                    const name = getTargetIngredientName();
                    if (!name) return triggerToast('재료를 선택하거나 입력하세요.', 'error');
                    const amount = customAmountInput.value || selectedAmount.value;
                    let abv = selectedIngredientAbv.value;
                    if (pickerTab.value === 'custom') abv = customIngredientAbv.value || 0;

                    recipeForm.ingredients.push({ name, amount, abv });
                    openIngredientPickerModal.value = false;
                };

                const removeIngredientFromRecipe = (idx) => { recipeForm.ingredients.splice(idx, 1); };

                const getIngredientAbv = (name, fallbackAbv = 0) => {
                    const found = catalog.value.find(c => c.name === name);
                    return found ? found.abv : (fallbackAbv || 0);
                };

                const getRecipeCalc = (ingList) => {
                    if (!ingList || ingList.length === 0) return { abv: '0%', totalVolume: 0, isNonAlcoholic: true };
                    let totalPureAlc = 0;
                    let totalMl = 0;

                    ingList.forEach(ing => {
                        const amtStr = ing.amount || '';
                        let ml = 30;
                        if (amtStr.includes('ml')) ml = parseFloat(amtStr) || 30;
                        else if (amtStr.includes('tsp')) ml = 5;
                        else if (amtStr.includes('Dash')) ml = 1;
                        
                        const abv = getIngredientAbv(ing.name, ing.abv);
                        totalMl += ml;
                        totalPureAlc += (ml * (abv / 100));
                    });

                    if (totalMl === 0) return { abv: '0%', totalVolume: 0, isNonAlcoholic: true };
                    const finalAbv = (totalPureAlc / totalMl) * 100;
                    return {
                        abv: finalAbv.toFixed(1) + '%',
                        totalVolume: Math.round(totalMl),
                        isNonAlcoholic: finalAbv === 0
                    };
                };

                const currentFormCalc = computed(() => getRecipeCalc(recipeForm.ingredients));

                const openModalForNewRecipe = () => {
                    editingRecipe.value = null;
                    Object.assign(recipeForm, { name: '', category: '커스텀', description: '', ingredients: [] });
                    openRecipeModal.value = true;
                };

                // 기존 UI의 [취소/X] 버튼이 실제로 모달을 닫도록 보완
                const closeRecipeModal = () => {
                    openRecipeModal.value = false;
                    editingRecipe.value = null;
                };

                const editRecipe = (rec) => {
                    editingRecipe.value = rec;
                    recipeForm.name = rec.name;
                    recipeForm.category = rec.category;
                    recipeForm.description = rec.description;
                    recipeForm.ingredients = JSON.parse(JSON.stringify(rec.ingredients));
                    openRecipeModal.value = true;
                };

                const saveRecipe = () => {
                    if (!recipeForm.name) return triggerToast('레시피 이름을 입력하세요.', 'error');
                    if (editingRecipe.value) {
                        Object.assign(editingRecipe.value, JSON.parse(JSON.stringify(recipeForm)));
                    } else {
                        recipes.value.push({ id: 'r_' + Date.now(), ...JSON.parse(JSON.stringify(recipeForm)) });
                    }
                    openRecipeModal.value = false;
                    triggerToast('레시피가 저장되었습니다.');
                };

                const askDeleteRecipe = (rec) => {
                    openConfirmModal('레시피 삭제', `'${rec.name}' 레시피를 삭제하시겠습니까?`, () => {
                        recipes.value = recipes.value.filter(r => r.id !== rec.id);
                        triggerToast('삭제되었습니다.');
                    });
                };

                const addIbaToMyRecipes = (iba) => {
                    // 중복 등록 방지: 같은 IBA 레시피가 이미 저장되어 있으면 다시 추가하지 않습니다.
                    if (isIbaRecipeSaved(iba)) {
                        triggerToast(`'${iba.name}'은(는) 이미 내 레시피에 등록되어 있습니다.`, 'info');
                        return;
                    }

                    recipes.value.push({
                        id: 'r_iba_' + Date.now(),
                        ibaId: iba.id || '',
                        source: 'IBA',
                        name: iba.name,
                        category: iba.category,
                        description: iba.description,
                        ingredients: iba.ingredients.map(i => ({ name: i.name, amount: i.amount, abv: i.abv || 0 }))
                    });
                    triggerToast(`'${iba.name}' 레시피가 내 레시피에 저장되었습니다.`);
                };

                const saveIbaWithSubstitution = (iba, missingName, replacementName) => {
                    if (!isIngredientOwned(replacementName)) {
                        triggerToast(`'${replacementName}' 재료가 현재 보유 상태가 아닙니다.`, 'error');
                        return;
                    }
                    const customIngredients = iba.ingredients.map(ing => ({
                        name: ingredientNamesMatch(ing.name, missingName) ? replacementName : ing.name,
                        amount: ing.amount,
                        abv: ingredientNamesMatch(ing.name, missingName) ? getIngredientAbv(replacementName, 0) : (ing.abv || 0)
                    }));
                    const customName = `${iba.name} · ${replacementName} 대체`;
                    const duplicated = recipes.value.some(r =>
                        normalizeRecipeName(r.name) === normalizeRecipeName(customName) ||
                        (r.baseIbaId && String(r.baseIbaId) === String(iba.id) && r.substitution?.from === missingName && r.substitution?.to === replacementName)
                    );
                    if (duplicated) {
                        triggerToast('같은 대체 레시피가 이미 내 레시피에 있습니다.', 'info');
                        return;
                    }
                    recipes.value.push({
                        id: 'r_iba_custom_' + Date.now(), baseIbaId: iba.id || '', source: 'IBA_CUSTOM',
                        name: customName, category: iba.category,
                        description: `${iba.name}의 사용자 커스텀 변형입니다. ${missingName} 대신 ${replacementName}을 사용합니다.`,
                        ingredients: customIngredients, substitution: { from: missingName, to: replacementName }
                    });
                    triggerToast(`'${customName}'을(를) 내 레시피에 저장했습니다.`);
                };

                const customizeAndEditIbaRecipe = (iba) => {
                    editingRecipe.value = null;
                    recipeForm.name = iba.name + ' (커스텀)';
                    recipeForm.category = iba.category;
                    recipeForm.description = iba.description;
                    recipeForm.ingredients = iba.ingredients.map(i => ({ name: i.name, amount: i.amount, abv: i.abv || 0 }));
                    openRecipeModal.value = true;
                };

                // 테이스팅 노트
                const openTastingModal = (rec) => {
                    currentTastingTarget.value = rec;
                    if (rec.tastingNote) {
                        Object.assign(tastingForm, rec.tastingNote);
                    } else {
                        Object.assign(tastingForm, { rating: 5, nosing: '', tasting: '', finish: '', review: '', date: new Date().toISOString().substring(0, 10) });
                    }
                    showTastingModal.value = true;
                };

                const saveTastingNote = () => {
                    if (currentTastingTarget.value) {
                        currentTastingTarget.value.tastingNote = { ...tastingForm };
                        if (currentTastingTarget.value.ibaId) {
                            const iba = ibaOfficialDatabase.find(item => String(item.id) === String(currentTastingTarget.value.ibaId));
                            if (iba) getIbaMeta(iba).tasted = true;
                        }
                        triggerToast('시음 노트가 저장되었습니다. IBA 도감에도 마셔본 기록이 반영되었습니다.');
                    }
                    showTastingModal.value = false;
                };

                const copyText = async (value) => {
                    if (!value) return;
                    try { await navigator.clipboard.writeText(String(value)); triggerToast('클립보드에 복사했습니다.'); }
                    catch (_) { triggerToast('복사에 실패했습니다.', 'error'); }
                };

                // JSON 가져오기 / 내보내기
                const exportData = () => {
                    if (!isAdmin.value) return triggerToast('데이터 내보내기는 관리자만 사용할 수 있습니다.', 'error');
                    const data = {
                        catalog: catalog.value,
                        customCellar: customCellar.value,
                        nonAlcoholic: defaultNonAlcoholicIngredients.value,
                        recipes: recipes.value,
                        substitutions: substitutionRules.value,
                        ibaMeta: ibaMeta
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `BarTail_Backup_${new Date().toISOString().substring(0,10)}.json`;
                    a.click();
                };

                const importData = (event) => {
                    if (!isAdmin.value) {
                        event.target.value = '';
                        return triggerToast('데이터 가져오기는 관리자만 사용할 수 있습니다.', 'error');
                    }
                    const file = event.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const parsed = JSON.parse(e.target.result);
                            if (Array.isArray(parsed.catalog)) catalog.value = parsed.catalog;
                            if (Array.isArray(parsed.customCellar)) customCellar.value = parsed.customCellar.map(normalizeCustomCellarItem).filter(item => item.name);
                            const importedIngredients = parsed.nonAlcoholic || parsed.ingredients;
                            if (Array.isArray(importedIngredients)) {
                                defaultNonAlcoholicIngredients.value = importedIngredients
                                    .map(normalizeStoredIngredient)
                                    .filter(item => item.name);
                            }
                            if (Array.isArray(parsed.recipes)) recipes.value = parsed.recipes;
                            if (Array.isArray(parsed.substitutions)) substitutionRules.value = parsed.substitutions.map(normalizeSubstitutionRule).filter(rule => rule.from && rule.to);
                            if (parsed.ibaMeta && typeof parsed.ibaMeta === 'object') Object.assign(ibaMeta, parsed.ibaMeta);
                            triggerToast('데이터를 성공적으로 불러왔습니다.');
                        } catch (err) {
                            triggerToast('올바르지 않은 JSON 파일입니다.', 'error');
                        }
                    };
                    reader.readAsText(file);
                };

                const handleImageError = (e) => {
                    e.target.src = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500&auto=format&fit=crop&q=60';
                };

                const handleItemImageUpload = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => itemForm.image = ev.target.result;
                        reader.readAsDataURL(file);
                    }
                };

                return {
                    currentTab, sidebarOpen, navGroups, catalogSearch, selectedCategory, categories, catalog, catalogWishlistOnly,
                    wishlistCatalog, filteredCatalog, ownedCatalog, setStatus, openModalForAdd, editItem, closeItemModal, saveItem,
                    showCustomCellarModal, openCustomCellarModal: openCustomCellarModalFn, closeCustomCellarModal, saveCustomCellarItem, removeCustomCellarItem, customCellar, customCellarForm, fallbackBottleImage,
                    openItemModal, itemForm, editingItem, askDeleteCatalogItem, imageSearchResults, imageSearchLoading, openGoogleImageSearch, searchAlcoholProductImage, selectAlcoholImage,
                    nonAlcoholicSearch, selectedNaCategory, nonAlcoholicCategories, filteredNonAlcoholicIngredients,
                    toggleIngredientOwned, openNaIngredientModal, naForm, openCustomIngredientModal, saveCustomNaIngredient,
                    getCategoryIcon, isIngredientOwned, getAppliedSubstitutions, isIngredientSubstituted,
                    ibaSearch, ibaCategory, ibaStatusFilter, ibaOfficialDatabase, filteredIbaDirectory, readyIbaRecipes, almostIbaRecipes, oneIngredientUnlocks,
                    favoriteIbaRecipesCount, tastedIbaRecipesCount, isIbaRecipeSaved, isIbaFavorite, isIbaTasted, toggleIbaFavorite, toggleIbaTasted, getAlternativeIngredients,
                    showIbaDetailModal, selectedIbaDetail, openIbaDetail, closeIbaDetail, getIbaDetailMissing, getIbaDetailOwnedCount, getIbaDetailProgress,
                    recipes, openRecipeModal, recipeForm, editingRecipe, openModalForNewRecipe, editRecipe, closeRecipeModal, saveRecipe, askDeleteRecipe,
                    openIngredientPickerModal, pickerTab, pickerSearch, selectedIngredientName, customIngredientName, customIngredientAbv, selectedAmount, customAmountInput,
                    filteredPickerCatalog, filteredPickerNonAlc, openIngredientPicker, selectCatalogIngredient, selectNaIngredient, getTargetIngredientName, confirmAddIngredient, removeIngredientFromRecipe,
                    getIngredientAbv, getRecipeCalc, currentFormCalc, addIbaToMyRecipes, customizeAndEditIbaRecipe, saveIbaWithSubstitution,
                    showTastingModal, currentTastingTarget, tastingForm, openTastingModal, saveTastingNote,
                    substitutionSearch, substitutionForm, editingSubstitutionIndex, substitutionRules, filteredSubstitutionRules,
                    openSubstitutionEditor, saveSubstitutionRule, toggleSubstitutionRule, deleteSubstitutionRule, restoreDefaultSubstitutions, resetSubstitutionForm,
                    toast, confirmModal, executeConfirmAction, getTabTitle, exportData, importData, handleImageError, handleItemImageUpload,
                    profileForm, profileSaving, profileInitial, loadMyProfile, saveMyProfile, removeProfileAvatar, handleProfileAvatarUpload, sanitizeNickname, getProfileInitial,
                    chatUserSearch, chatUsers, chatLoading, filteredChatUsers, selectedChatUser, chatMobileView, chatMessages, chatMessagesLoading, chatSending, chatDraft, chatUnreadCount, lastChatSentAt, chatMessagesEl, loadChatDirectory, loadChatList, startChatListPolling, openChatWith, closeMobileChat, sendChatMessage, formatChatTime,
                    firebaseReady, firebaseConfigured, currentUser, isAdmin, impersonationMode, impersonationStartedAt, serviceAccess, hasServiceAccess, accessRemainingText, accessStatusLoading, accessStatusError, authMode, authLoading, authError, authForm, firebaseStatusMessage,
                    signIn, signUp, sendPasswordReset, signOutUser, returnToAdmin, loginAsUser, activateAccessKey, contactLink, openContactLink, adminKeys, adminKeysLoading, adminUsers, adminUsersLoading, adminUsersError, adminUserSearch, adminUserStatusFilter, filteredAdminUsers, adminKeySearch, adminKeyStatusFilter, filteredAdminKeys, adminAuditLogs, adminAuditLoading, loadAdminAuditLogs, keyExpandedId, adminKeyForm, generatedAccessKey, createAccessKey, loadAdminKeys, loadAdminUsers, deleteRegisteredUser, revokeAccessKey, toggleKeyUsers, extendAccessKey, deleteAccessKey, copyGeneratedKey, copyText,
                    contactLinkForm, saveContactLink, loadAdminSettings, webIcon, webIconForm, handleWebIconUpload, cancelWebIconSelection, saveWebIcon, deleteWebIcon, suggestionModal, suggestionSubmitting, suggestionsLoading, catalogSuggestions, suggestionForm, openSuggestionModal, closeSuggestionModal, submitCatalogSuggestion, loadCatalogSuggestions, approveCatalogSuggestion, rejectCatalogSuggestion
                };
            }
        }).mount('#app');
    