        // ============ GOOGLE GİRİŞ (OAuth) ============
        const GOOGLE_CLIENT_ID = '551576148878-m343v2l3iofhj620t5v7r86hlnhhfsjb.apps.googleusercontent.com';
        const ALLOWED_EMAIL = 'ozgun.demiray91@gmail.com'; // Sadece bu email giriş yapabilir
        let googleIdToken = null;
        let currentUserEmail = null;

        function initGoogleSignIn() {
            google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleSignIn
            });
            google.accounts.id.renderButton(
                document.getElementById('googleSignInButton'),
                { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill' }
            );
        }

        function handleGoogleSignIn(response) {
            // Token'ı decode et (JWT'nin payload kısmını oku)
            const payload = JSON.parse(atob(response.credential.split('.')[1]));
            const email = payload.email;
            const loginError = document.getElementById('loginError');

            if (email !== ALLOWED_EMAIL) {
                loginError.textContent = 'Bu hesapla giriş yapılamaz: ' + email;
                loginError.style.display = 'block';
                return;
            }

            // Başarılı giriş
            googleIdToken = response.credential;
            currentUserEmail = email;
            sessionStorage.setItem('googleIdToken', response.credential);
            sessionStorage.setItem('googleUserEmail', email);

            showApp(email);
        }

        function showApp(email) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appContent').style.display = 'block';
            document.getElementById('userInfo').textContent = '👤 ' + email;
            initAppAfterLogin();
        }

        // Sayfa yenilendiğinde, oturum hala geçerliyse otomatik göster
        window.addEventListener('load', () => {
            const savedToken = sessionStorage.getItem('googleIdToken');
            const savedEmail = sessionStorage.getItem('googleUserEmail');
            if (savedToken && savedEmail === ALLOWED_EMAIL) {
                googleIdToken = savedToken;
                currentUserEmail = savedEmail;
                showApp(savedEmail);
            }
        });

        function logout() {
            sessionStorage.removeItem('googleIdToken');
            sessionStorage.removeItem('googleUserEmail');
            googleIdToken = null;
            currentUserEmail = null;
            location.reload();
        }

        // ============ ANA UYGULAMA ============
        // Durum Yönetimi
        let movies = JSON.parse(localStorage.getItem('filmKutuphanesi')) || [];
        let series = JSON.parse(localStorage.getItem('seriesKutuphanesi')) || [];
        let currentFilter = 'all';
        let searchQuery = '';
        let appsScriptUrl = 'https://script.google.com/macros/s/AKfycbzl2Xw5QEVQkd9kM5nvU8ovWwH1WHuMxRkvkn1b2oqGzg3MLW4ciQARD7DLZ10ZhrMbvw/exec';

        const OMDB_API = 'c3201f93';

        // ============ GERİ TUŞU (ANDROID) YÖNETİMİ ============
        // PWA olarak yüklendiğinde, açık panel/modal varken geri tuşuna basınca
        // uygulamadan çıkmak yerine önce o panel/modalı kapatmasını sağlar.
        let uiStack = []; // Açık olan panel/modalların kapatma fonksiyonlarını tutar
        let isClosingFromHistory = false; // popstate kaynaklı kapatma sırasında tekrar history.back() tetiklenmesin

        function pushUiState(closeFn) {
            uiStack.push(closeFn);
            history.pushState({ uiLayer: uiStack.length }, '');
        }

        // Manuel kapatma butonlarından çağrılır. Stack'e DOKUNMAZ -
        // sadece history.back() tetikler, gerçek temizlik popstate handler'ında, TEK YERDE yapılır.
        function popUiStateIfMatch(closeFn) {
            const idx = uiStack.lastIndexOf(closeFn);
            if (idx !== -1 && !isClosingFromHistory) {
                history.back();
            }
        }

        // Sadece stack'ten çıkar, history.back() ÇAĞIRMAZ (başka bir UI hemen açılacaksa kullanılır)
        function removeFromUiStackSilently(closeFn) {
            const idx = uiStack.lastIndexOf(closeFn);
            if (idx !== -1) uiStack.splice(idx, 1);
        }

        window.addEventListener('popstate', () => {
            if (uiStack.length > 0) {
                isClosingFromHistory = true;
                const closeFn = uiStack.pop();
                closeFn(true); // true: history'den çağrıldığını belirtir, tekrar history.back() tetiklemesin
                isClosingFromHistory = false;
            }
        });
        let lastGeminiDebugInfo = '';

        // Gemini API'ye basit bir metin sorusu gönderip yanıtı döndürür.
        // GÜVENLİK: İstek doğrudan Gemini'ye değil, Apps Script üzerinden (proxy) gidiyor.
        // Bu sayede Gemini API key'i tarayıcı kodunda (ve GitHub'da) hiç görünmüyor,
        // sadece Apps Script'in kendi içinde (sunucu tarafında) saklanıyor.
        async function askGemini(prompt) {
            if (!appsScriptUrl || !googleIdToken) {
                lastGeminiDebugInfo = 'Giriş yapılmamış veya Apps Script URL eksik';
                return null;
            }

            try {
                const response = await fetch(appsScriptUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        idToken: googleIdToken,
                        action: 'askGemini',
                        prompt: prompt
                    })
                });

                const rawText = await response.text();
                let data;
                try {
                    data = JSON.parse(rawText);
                } catch (e) {
                    lastGeminiDebugInfo = 'Yanıt JSON olarak okunamadı: ' + rawText.substring(0, 200);
                    return null;
                }

                if (!data.success) {
                    console.error('Gemini proxy hatası:', data.error);
                    lastGeminiDebugInfo = data.error || 'Bilinmeyen hata';
                    return null;
                }

                if (!data.text) {
                    lastGeminiDebugInfo = 'Beklenmeyen yanıt yapısı (text alanı boş)';
                }

                return data.text || null;
            } catch (error) {
                console.error('Gemini çağrı hatası:', error);
                lastGeminiDebugInfo = 'İstek hatası: ' + error.message;
                return null;
            }
        }

        // Gemini'den film adı listesi isteyip, satır satır ayrıştırır
        async function askGeminiForMovieTitles(prompt, count = 5) {
            const fullPrompt = `${prompt}\n\nSadece film adlarını, her satıra bir film adı olacak şekilde, başına numara veya tire koymadan, sadece orijinal (İngilizce) başlıklarıyla listele. Tam olarak ${count} film adı ver. Başka hiçbir açıklama, giriş veya yorum ekleme.`;

            const text = await askGemini(fullPrompt);
            if (!text) return [];

            return text
                .split('\n')
                .map(line => line.replace(/^[\d.\-\*\s]+/, '').trim())
                .filter(line => line.length > 0)
                .slice(0, count);
        }

        // DOM Elementleri
        const addMovieBtn = document.getElementById('addMovieBtn');
        const modal = document.getElementById('modal');
        const closeModalBtn = document.getElementById('closeModal');
        const movieForm = document.getElementById('movieForm');
        const searchInput = document.getElementById('searchInput');
        const moviesGrid = document.getElementById('moviesGrid');
        const emptyState = document.getElementById('emptyState');
        const movieSearchInput = document.getElementById('movieSearch');
        const searchSuggestions = document.getElementById('searchSuggestions');
        const appsScriptInput = document.getElementById('appsScriptUrl');
        const syncIndicator = document.getElementById('syncIndicator');
        const syncText = document.getElementById('syncText');
        const apiSetup = document.getElementById('apiSetup');
        const movieListPanel = document.getElementById('movieListPanel');
        const statsPanel = document.getElementById('statsPanel');
        const panelTitle = document.getElementById('panelTitle');
        const movieImdbUrlInput = document.getElementById('movieImdbUrl');

        // Dizi Liste/Detay DOM Elementleri (Dizi Ekle modalı kaldırıldı, ekleme artık ana modal üzerinden)
        const seriesListPanel = document.getElementById('seriesListPanel');
        const seriesGrid = document.getElementById('seriesGrid');
        const seriesEmptyState = document.getElementById('seriesEmptyState');
        const seriesPanelTitle = document.getElementById('seriesPanelTitle');
        const seriesDetailModal = document.getElementById('seriesDetailModal');
        const seriesDetailModalContent = document.getElementById('seriesDetailModalContent');

        // Sayfa yüklendiğinde
        appsScriptInput.value = appsScriptUrl;

        // Event Listeners
        addMovieBtn.addEventListener('click', () => openModal());
        document.getElementById('recommendBtn').addEventListener('click', () => showRecommendations());
        closeModalBtn.addEventListener('click', () => closeModal());
        movieForm.addEventListener('submit', (e) => handleAddMovie(e));
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            renderMovies();
        });
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderMovies();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // İstatistik kartlarına tıklama - panel açma
        function showMovieListPanel(filterValue, title) {
            currentFilter = filterValue;
            statsPanel.style.display = 'none';
            recommendPanel.style.display = 'none';
            movieListPanel.style.display = 'block';
            panelTitle.textContent = title;
            renderMovies();
            movieListPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            pushUiState(closeMovieListPanel);
        }

        function closeMovieListPanel(fromHistory) {
            movieListPanel.style.display = 'none';
            if (!fromHistory) popUiStateIfMatch(closeMovieListPanel);
        }

        document.getElementById('statTotal').addEventListener('click', () => showMovieListPanel('all', '🎬 Tüm Filmler'));
        document.getElementById('statWatched').addEventListener('click', () => showMovieListPanel('watched', '✓ İzlenen Filmler'));
        document.getElementById('statPending').addEventListener('click', () => showMovieListPanel('pending', '⏳ İzlenecek Filmler'));
        document.getElementById('statPercentage').addEventListener('click', () => showWatchStatsPanel());
        document.getElementById('statSeriesTotal').addEventListener('click', () => showSeriesListPanel('all', '📺 Tüm Diziler'));
        document.getElementById('statSeriesInProgress').addEventListener('click', () => showSeriesListPanel('inprogress', '▶️ İzlenmekte Olan Diziler'));
        document.getElementById('statSeriesCompleted').addEventListener('click', () => showSeriesListPanel('completed', '✓ Tamamlanan Diziler'));

        // Apps Script URL Kaydet (Tarayıcı Console'dan çağırılacak)
        function saveAppsScriptUrl(url) {
            // Eğer parametre yoksa, input'tan al
            if (!url) {
                url = appsScriptInput.value.trim();
            }
            
            if (!url) {
                console.log('URL hatası');
                return;
            }
            
            localStorage.setItem('appsScriptUrl', url);
            appsScriptUrl = url;
            console.log('✓ URL kaydedildi!');
            syncMoviesToDrive();
        }

        // OMDb Film Arama
        let searchTimeout;
        movieSearchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            
            if (query.length < 2) {
                searchSuggestions.classList.remove('active');
                return;
            }

            searchTimeout = setTimeout(() => {
                searchMovies(query);
            }, 300);
        });

        // IMDb Linki Yapıştırma - otomatik ID çıkarma ve film getirme
        movieImdbUrlInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const url = e.target.value.trim();
            
            // tt1234567 formatında ID'yi yakala
            const match = url.match(/tt\d{6,9}/);
            
            if (match) {
                searchTimeout = setTimeout(() => {
                    selectMovie(match[0]);
                }, 400);
            }
        });

        async function searchMovies(query) {
            try {
                searchSuggestions.innerHTML = '<div style="padding: 15px; text-align: center;"><div style="display: inline-block; width: 20px; height: 20px; border: 3px solid #d4af37; border-top: 3px solid #404040; border-radius: 50%; animation: spin 1s linear infinite;"></div></div>';
                
                // type filtresi YOK - hem film hem dizi sonuçları gelsin
                const response = await fetch(
                    `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${OMDB_API}`
                );
                const data = await response.json();

                if (data.Search) {
                    searchSuggestions.innerHTML = data.Search.slice(0, 8).map(item => {
                        const isSeries = item.Type === 'series';
                        const typeLabel = isSeries
                            ? '<span style="color:#9b7ff0; font-size:0.75em;">📺 Dizi</span>'
                            : '<span style="color:#d4af37; font-size:0.75em;">🎬 Film</span>';
                        return `
                        <div class="suggestion-item" onclick="selectMovie('${item.imdbID}')">
                            <div style="flex: 1;">
                                <div style="font-weight: 600;">${item.Title}</div>
                                <div style="font-size: 0.8em; color: #999;">${item.Year} · ${typeLabel}</div>
                            </div>
                        </div>
                    `;
                    }).join('');
                    searchSuggestions.classList.add('active');
                } else {
                    searchSuggestions.innerHTML = '<div style="padding: 15px; text-align: center; color: #999;">Sonuç bulunamadı</div>';
                    searchSuggestions.classList.add('active');
                }
            } catch (error) {
                console.error('Arama hatası:', error);
                searchSuggestions.innerHTML = '<div style="padding: 15px; text-align: center; color: #ff5576;">Hata oluştu</div>';
                searchSuggestions.classList.add('active');
            }
        }

        // Ücretsiz Google Translate (gayriresmi endpoint)
        async function translateText(text) {
            if (!text || text === 'N/A') return text;
            try {
                const response = await fetch(
                    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(text)}`
                );
                const data = await response.json();
                // Yanıt parçalı gelir, hepsini birleştir
                return data[0].map(part => part[0]).join('');
            } catch (error) {
                console.error('Çeviri hatası:', error);
                return text; // Hata olursa orijinal metni döndür
            }
        }

        async function selectMovie(imdbID) {
            try {
                searchSuggestions.classList.remove('active');
                movieSearchInput.value = 'Yükleniyor...';
                document.getElementById('moviePreviewArea').innerHTML = `
                    <div style="text-align: center; padding: 20px;"><div class="loading-spinner"></div></div>
                `;

                const response = await fetch(
                    `https://www.omdbapi.com/?i=${imdbID}&apikey=${OMDB_API}&plot=full`
                );
                const movie = await response.json();

                if (movie.Response !== 'False') {
                    const isSeries = movie.Type === 'series';

                    // Film/Dizi adı İNGİLİZCE kalır (çevrilmez)
                    document.getElementById('movieName').value = movie.Title;
                    document.getElementById('movieNameTR').value = movie.Title; // Varsayılan olarak aynı, siz değiştirebilirsiniz
                    document.getElementById('movieYear').value = movie.Year;

                    // Diğer her şey Türkçeye çevrilir
                    const [genreTR, plotTR, directorTR, actorsTR, writerTR, awardsTR] = await Promise.all([
                        translateText(movie.Genre),
                        translateText(movie.Plot),
                        translateText(movie.Director),
                        translateText(movie.Actors),
                        translateText(movie.Writer),
                        translateText(movie.Awards)
                    ]);

                    document.getElementById('movieGenre').value = movie.Genre !== 'N/A' ? genreTR : 'Belirtilmemiş';
                    document.getElementById('moviePlot').value = movie.Plot !== 'N/A' ? plotTR : 'Açıklama yok';
                    document.getElementById('movieDirector').value = movie.Director !== 'N/A' ? directorTR : 'Belirtilmemiş';
                    document.getElementById('movieRating').value = movie.imdbRating !== 'N/A' ? movie.imdbRating : 'N/A';

                    // Poster URL'sini gizli bir data attribute'a kaydet
                    movieForm.dataset.posterUrl = movie.Poster !== 'N/A' ? movie.Poster : '';

                    // Yeni alanları gizli data attribute'larına kaydet
                    movieForm.dataset.actors = movie.Actors !== 'N/A' ? actorsTR : '';
                    movieForm.dataset.writer = movie.Writer !== 'N/A' ? writerTR : '';
                    movieForm.dataset.runtime = movie.Runtime !== 'N/A' ? movie.Runtime : '';
                    movieForm.dataset.rated = movie.Rated !== 'N/A' ? movie.Rated : '';
                    movieForm.dataset.released = movie.Released !== 'N/A' ? movie.Released : '';
                    movieForm.dataset.language = movie.Language !== 'N/A' ? movie.Language : '';
                    movieForm.dataset.country = movie.Country !== 'N/A' ? movie.Country : '';
                    movieForm.dataset.awards = movie.Awards !== 'N/A' ? awardsTR : '';
                    movieForm.dataset.boxoffice = movie.BoxOffice !== 'N/A' ? movie.BoxOffice : '';
                    movieForm.dataset.type = movie.Type || '';
                    movieForm.dataset.imdbID = movie.imdbID;

                    // Rotten Tomatoes ve Metacritic puanlarını Ratings dizisinden bul
                    let rottenTomatoes = '';
                    let metacritic = '';
                    if (Array.isArray(movie.Ratings)) {
                        movie.Ratings.forEach(r => {
                            if (r.Source === 'Rotten Tomatoes') rottenTomatoes = r.Value;
                            if (r.Source === 'Metacritic') metacritic = r.Value;
                        });
                    }
                    movieForm.dataset.rottenTomatoes = rottenTomatoes;
                    movieForm.dataset.metacritic = metacritic;

                    movieSearchInput.value = movie.Title;

                    // Etiketleri/başlığı türe göre ayarla
                    document.getElementById('modalHeaderTitle').textContent = isSeries ? '📺 Dizi Ekle' : '🎬 Film Ekle';
                    document.getElementById('nameTRLabel').textContent = isSeries ? 'Dizi Adı (Türkçe - Düzenlenebilir)' : 'Film Adı (Türkçe - Düzenlenebilir)';
                    document.getElementById('mainSaveBtn').style.background = isSeries ? '#9b7ff0' : '';

                    let seasons = [];
                    let totalSeasons = 0;

                    if (isSeries) {
                        totalSeasons = parseInt(movie.totalSeasons) || 0;

                        // Sezonları sırayla çek (her sezon ayrı istek)
                        for (let s = 1; s <= totalSeasons; s++) {
                            document.getElementById('moviePreviewArea').innerHTML = `
                                <div style="text-align: center; padding: 20px;">
                                    <div class="loading-spinner"></div>
                                    <p style="color: #999; font-size: 0.85em; margin-top: 8px;">Sezon ${s}/${totalSeasons} yükleniyor...</p>
                                </div>
                            `;
                            try {
                                const seasonResponse = await fetch(`https://www.omdbapi.com/?i=${imdbID}&Season=${s}&apikey=${OMDB_API}`);
                                const seasonData = await seasonResponse.json();

                                if (seasonData.Response !== 'False' && Array.isArray(seasonData.Episodes)) {
                                    seasons.push({
                                        seasonNumber: s,
                                        episodes: seasonData.Episodes.map(ep => ({
                                            episodeNumber: parseInt(ep.Episode) || 0,
                                            title: ep.Title || '',
                                            released: ep.Released || '',
                                            watched: false
                                        }))
                                    });
                                }
                            } catch (e) {
                                console.error('Sezon ' + s + ' yüklenemedi:', e);
                            }
                        }

                        movieForm.dataset.seasonsData = JSON.stringify(seasons);
                        movieForm.dataset.totalSeasons = totalSeasons;
                    } else {
                        movieForm.dataset.seasonsData = '';
                        movieForm.dataset.totalSeasons = '';
                    }

                    renderMoviePreview({
                        title: movie.Title,
                        type: movie.Type,
                        year: movie.Year,
                        runtime: movie.Runtime !== 'N/A' ? movie.Runtime : '',
                        rated: movie.Rated !== 'N/A' ? movie.Rated : '',
                        rating: movie.imdbRating !== 'N/A' ? movie.imdbRating : '',
                        rottenTomatoes: rottenTomatoes,
                        metacritic: metacritic,
                        genre: movie.Genre !== 'N/A' ? genreTR : 'Belirtilmemiş',
                        director: movie.Director !== 'N/A' ? directorTR : 'Belirtilmemiş',
                        writer: movie.Writer !== 'N/A' ? writerTR : '',
                        actors: movie.Actors !== 'N/A' ? actorsTR : '',
                        plot: movie.Plot !== 'N/A' ? plotTR : 'Açıklama yok',
                        awards: movie.Awards !== 'N/A' ? awardsTR : '',
                        country: movie.Country !== 'N/A' ? movie.Country : '',
                        language: movie.Language !== 'N/A' ? movie.Language : '',
                        released: movie.Released !== 'N/A' ? movie.Released : '',
                        boxoffice: movie.BoxOffice !== 'N/A' ? movie.BoxOffice : '',
                        posterUrl: movie.Poster !== 'N/A' ? movie.Poster : '',
                        totalSeasons: totalSeasons,
                        totalEpisodes: seasons.reduce((sum, se) => sum + se.episodes.length, 0)
                    });

                    document.getElementById('movieNameTRGroup').style.display = 'block';
                    document.getElementById('myRatingGroup').style.display = isSeries ? 'none' : 'block';

                    showToast((isSeries ? 'Dizi' : 'Film') + ' bilgileri yüklendi! ✓');
                }
            } catch (error) {
                console.error('Film yükleme hatası:', error);
                showToast('Film bilgileri yüklenemedi');
            }
        }

        // Film Ekle modalında, detay modalına benzer zengin bir önizleme gösterir
        function renderMoviePreview(m) {
            const isSeries = m.type === 'series';
            const typeLabel = isSeries
                ? '<span style="background:#9b7ff020; color:#9b7ff0; padding:4px 10px; border-radius:6px; font-size:0.8em; font-weight:600;">📺 Dizi</span>'
                : '<span style="background:#d4af3720; color:#d4af37; padding:4px 10px; border-radius:6px; font-size:0.8em; font-weight:600;">🎬 Film</span>';

            document.getElementById('moviePreviewArea').innerHTML = `
                <div style="background: #1a1a1a; border-radius: 10px; padding: 18px; margin-bottom: 15px; border: 1px solid #333;">
                    <div style="text-align: center; margin-bottom: 12px;">
                        <div style="width: 100%; max-height: 260px; border-radius: 8px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                            ${m.posterUrl
                                ? `<img src="${m.posterUrl}" alt="${m.title}" style="width: 100%; object-fit: contain; max-height: 260px;">`
                                : `<span style="font-size: 3em; padding: 50px 0;">${isSeries ? '📺' : '🎬'}</span>`
                            }
                        </div>
                    </div>

                    <div style="margin-bottom: 8px;">${typeLabel}</div>
                    <h3 style="color: ${isSeries ? '#9b7ff0' : '#d4af37'}; margin-bottom: 10px;">${m.title}</h3>

                    <div style="display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap;">
                        <span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">📅 ${m.year}</span>
                        ${m.runtime ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">⏱️ ${m.runtime}</span>` : ''}
                        ${isSeries && m.totalSeasons ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">📦 ${m.totalSeasons} Sezon</span>` : ''}
                        ${isSeries && m.totalEpisodes ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">🎞️ ${m.totalEpisodes} Bölüm</span>` : ''}
                        ${m.rated ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">🔞 ${m.rated}</span>` : ''}
                        ${m.rating ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">⭐ ${m.rating}</span>` : ''}
                        ${m.rottenTomatoes ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">🍅 ${m.rottenTomatoes}</span>` : ''}
                        ${m.metacritic ? `<span style="background: #2a2a2a; padding: 4px 10px; border-radius: 6px; font-size: 0.85em;">Ⓜ️ ${m.metacritic}</span>` : ''}
                    </div>

                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">Tür: </span>
                        <span style="color: #ccc;">${m.genre}</span>
                    </div>

                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">Yönetmen: </span>
                        <span style="color: #ccc;">${m.director}</span>
                    </div>

                    ${m.writer ? `
                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">Senarist: </span>
                        <span style="color: #ccc;">${m.writer}</span>
                    </div>` : ''}

                    ${m.actors ? `
                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">🎭 Oyuncular: </span>
                        <span style="color: #ccc;">${m.actors}</span>
                    </div>` : ''}

                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">Konusu: </span>
                        <span style="color: #ccc; line-height: 1.4;">${m.plot}</span>
                    </div>

                    ${m.awards ? `
                    <div style="margin-bottom: 10px; font-size: 0.9em;">
                        <span style="color: #d4af37; font-weight: 600;">🏆 Ödüller: </span>
                        <span style="color: #ccc;">${m.awards}</span>
                    </div>` : ''}

                    <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.8em; color: #888;">
                        ${m.country ? `<span>🌍 ${m.country}</span>` : ''}
                        ${m.language ? `<span>🗣️ ${m.language}</span>` : ''}
                        ${m.released ? `<span>🎬 Vizyon: ${m.released}</span>` : ''}
                        ${m.boxoffice ? `<span>💰 ${m.boxoffice}</span>` : ''}
                    </div>
                </div>
            `;
        }

        // Film Ekleme
        function handleAddMovie(e) {
            e.preventDefault();

            const name = document.getElementById('movieName').value;
            const nameTR = document.getElementById('movieNameTR').value;

            if (!name.trim()) {
                showToast('Lütfen bir film veya dizi seçin');
                return;
            }

            const isSeries = movieForm.dataset.type === 'series';

            if (isSeries) {
                // ============ DİZİ OLARAK KAYDET ============
                let seasons = [];
                try {
                    seasons = JSON.parse(movieForm.dataset.seasonsData || '[]');
                } catch (e) {
                    seasons = [];
                }

                const newSeries = {
                    id: Date.now(),
                    imdbID: movieForm.dataset.imdbID || '',
                    name: name.trim(),
                    nameTR: (nameTR || name).trim(),
                    year: document.getElementById('movieYear').value,
                    genre: document.getElementById('movieGenre').value,
                    plot: document.getElementById('moviePlot').value,
                    rating: document.getElementById('movieRating').value,
                    posterUrl: movieForm.dataset.posterUrl || '',
                    director: document.getElementById('movieDirector').value, // OMDb'de diziler için "Yaratıcı" bilgisi burada gelir
                    actors: movieForm.dataset.actors || '',
                    writer: movieForm.dataset.writer || '',
                    runtime: movieForm.dataset.runtime || '',
                    rated: movieForm.dataset.rated || '',
                    released: movieForm.dataset.released || '',
                    language: movieForm.dataset.language || '',
                    country: movieForm.dataset.country || '',
                    awards: movieForm.dataset.awards || '',
                    boxoffice: movieForm.dataset.boxoffice || '',
                    rottenTomatoes: movieForm.dataset.rottenTomatoes || '',
                    metacritic: movieForm.dataset.metacritic || '',
                    totalSeasons: parseInt(movieForm.dataset.totalSeasons) || 0,
                    seasons: seasons,
                    dateAdded: new Date().toISOString()
                };

                series.push(newSeries);
                saveSeries();
                closeModal();
                renderSeriesStats();
                syncSeriesToDrive();
                showToast('Dizi eklendi! 📺');
                return;
            }

            // ============ FİLM OLARAK KAYDET ============
            const year = document.getElementById('movieYear').value;
            const genre = document.getElementById('movieGenre').value;
            const plot = document.getElementById('moviePlot').value;
            const director = document.getElementById('movieDirector').value;
            const rating = document.getElementById('movieRating').value;
            const myRating = document.getElementById('myRating').value;

            const movie = {
                id: Date.now(),
                name: name.trim(),
                nameTR: (nameTR || name).trim(),
                year: year,
                genre: genre,
                plot: plot,
                director: director,
                rating: rating,
                myRating: myRating || null,
                posterUrl: movieForm.dataset.posterUrl || '',
                actors: movieForm.dataset.actors || '',
                writer: movieForm.dataset.writer || '',
                runtime: movieForm.dataset.runtime || '',
                rated: movieForm.dataset.rated || '',
                released: movieForm.dataset.released || '',
                language: movieForm.dataset.language || '',
                country: movieForm.dataset.country || '',
                awards: movieForm.dataset.awards || '',
                boxoffice: movieForm.dataset.boxoffice || '',
                rottenTomatoes: movieForm.dataset.rottenTomatoes || '',
                metacritic: movieForm.dataset.metacritic || '',
                type: movieForm.dataset.type || 'movie',
                watched: false,
                dateAdded: new Date().toISOString()
            };

            movies.push(movie);
            saveMovies();
            closeModal();
            renderMovies();
            updateStats();
            syncMoviesToDrive();
            showToast('Film eklendi! 🎬');
        }

        // Film İzlendi Olarak İşaretleme
        function toggleWatched(id) {
            const movie = movies.find(m => m.id === id);
            if (movie) {
                movie.watched = !movie.watched;
                movie.watchedDate = movie.watched ? new Date().toISOString() : null;
                saveMovies();
                renderMovies();
                updateStats();
                syncMoviesToDrive();
                showToast(movie.watched ? 'İzlendi olarak işaretlendi ✓' : 'İzlenmedi olarak işaretlendi');
            }
        }

        // Film Silme
        function deleteMovie(id) {
            if (confirm('Bu filmi silmek istediğinize emin misiniz?')) {
                movies = movies.filter(m => m.id !== id);
                saveMovies();
                renderMovies();
                updateStats();
                syncMoviesToDrive();
                showToast('Film silindi');
            }
        }

        // Filtreleme ve Arama
        let currentSort = 'dateAdded_desc';

        function getFilteredMovies() {
            let result = movies.filter(movie => {
                const matchesFilter = 
                    currentFilter === 'all' ||
                    (currentFilter === 'watched' && movie.watched) ||
                    (currentFilter === 'pending' && !movie.watched);
                
                const matchesSearch = 
                    movie.name.toLowerCase().includes(searchQuery) ||
                    movie.genre.toLowerCase().includes(searchQuery) ||
                    movie.year.toString().includes(searchQuery);

                return matchesFilter && matchesSearch;
            });

            result = sortMovies(result, currentSort);

            return result;
        }

        // Filmleri seçilen kritere göre sıralama
        function sortMovies(list, sortKey) {
            const sorted = [...list];

            const num = (v) => {
                const n = parseFloat(v);
                return isNaN(n) ? -Infinity : n;
            };

            switch (sortKey) {
                case 'dateAdded_desc':
                    sorted.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
                    break;
                case 'dateAdded_asc':
                    sorted.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded));
                    break;
                case 'rating_desc':
                    sorted.sort((a, b) => num(b.rating) - num(a.rating));
                    break;
                case 'rating_asc':
                    sorted.sort((a, b) => num(a.rating) - num(b.rating));
                    break;
                case 'myRating_desc':
                    sorted.sort((a, b) => num(b.myRating) - num(a.myRating));
                    break;
                case 'year_desc':
                    sorted.sort((a, b) => num(b.year) - num(a.year));
                    break;
                case 'year_asc':
                    sorted.sort((a, b) => num(a.year) - num(b.year));
                    break;
                case 'name_asc':
                    sorted.sort((a, b) => (a.nameTR || a.name).localeCompare(b.nameTR || b.name, 'tr'));
                    break;
            }

            return sorted;
        }

        // Film Kartlarını Render Etme
        function renderMovies() {
            const filteredMovies = getFilteredMovies();

            if (filteredMovies.length === 0 && movies.length === 0) {
                moviesGrid.innerHTML = '';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';

            if (filteredMovies.length === 0) {
                moviesGrid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">
                        <p style="font-size: 1.1em;">Arama sonucu bulunamadı</p>
                    </div>
                `;
                return;
            }

            moviesGrid.innerHTML = filteredMovies.map(movie => `
                <div class="movie-card ${movie.watched ? 'watched' : ''}" onclick="openDetailModal(${movie.id})">
                    <div class="movie-poster ${movie.watched ? 'watched' : ''}">
                        ${movie.posterUrl ? `<img src="${movie.posterUrl}" alt="${movie.name}">` : '<span style="font-size: 2em;">🎬</span>'}
                    </div>
                    <div class="movie-info">
                        <div class="movie-title">${movie.nameTR || movie.name}</div>
                        <div class="movie-meta">
                            <span>${movie.year}</span>
                            ${movie.rating && movie.rating !== 'N/A' ? `<span>⭐ ${movie.rating}</span>` : ''}
                        </div>
                        <div class="movie-genre">${movie.genre}</div>
                        <div class="movie-actions" onclick="event.stopPropagation()">
                            ${movie.watched 
                                ? `<button class="movie-btn watched-check-btn" onclick="toggleWatched(${movie.id})" title="İşareti geri al">
                                    <span style="font-size: 1.2em; color: #00f0a0;">✓</span>
                                   </button>`
                                : `<button class="movie-btn watch-btn" onclick="toggleWatched(${movie.id})">İzle</button>`
                            }
                            <button class="movie-btn delete-btn" onclick="deleteMovie(${movie.id})">
                                🗑️
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');

            renderPosterGallery(filteredMovies);
        }

        // ============ GALERİ (POSTER) GÖRÜNÜMÜ ============
        let galleryViewActive = false;
        const posterGallery = document.getElementById('posterGallery');
        const galleryToggleBtn = document.getElementById('galleryToggleBtn');

        galleryToggleBtn.addEventListener('click', () => {
            galleryViewActive = !galleryViewActive;
            moviesGrid.style.display = galleryViewActive ? 'none' : '';
            posterGallery.style.display = galleryViewActive ? 'grid' : 'none';
            galleryToggleBtn.style.background = galleryViewActive ? '#d4af37' : '#2a2a2a';
            galleryToggleBtn.style.color = galleryViewActive ? '#1a1a1a' : '#e0e0e0';
        });

        function renderPosterGallery(filteredMovies) {
            if (filteredMovies.length === 0) {
                posterGallery.innerHTML = '';
                return;
            }

            posterGallery.innerHTML = filteredMovies.map(movie => `
                <div onclick="openDetailModal(${movie.id})" style="cursor: pointer; position: relative; aspect-ratio: 2/3; border-radius: 8px; overflow: hidden; background: #2a2a2a; border: 2px solid ${movie.watched ? '#00f0a0' : 'transparent'};">
                    ${movie.posterUrl
                        ? `<img src="${movie.posterUrl}" alt="${movie.name}" style="width: 100%; height: 100%; object-fit: cover;">`
                        : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size: 2em;">🎬</div>`
                    }
                    ${movie.watched ? `<div style="position: absolute; top: 4px; right: 4px; background: #00f0a0; color: #1a1a1a; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: bold;">✓</div>` : ''}
                </div>
            `).join('');
        }

        // İstatistikleri Güncelleme
        function updateStats() {
            const total = movies.length;
            const watched = movies.filter(m => m.watched).length;
            const pending = total - watched;
            const percentage = total === 0 ? 0 : Math.round((watched / total) * 100);

            document.getElementById('totalMovies').textContent = total;
            document.getElementById('watchedMovies').textContent = watched;
            document.getElementById('pendingMovies').textContent = pending;
            document.getElementById('watchPercentage').textContent = percentage + '%';
        }

        // İzleme İstatistik Paneli (tür bazlı kırılım)
        function showWatchStatsPanel() {
            movieListPanel.style.display = 'none';
            recommendPanel.style.display = 'none';
            statsPanel.style.display = 'block';

            const total = movies.length;
            const watched = movies.filter(m => m.watched).length;
            const percentage = total === 0 ? 0 : Math.round((watched / total) * 100);

            // Zaman bazlı kırılım (sadece watchedDate'i olan filmler için sağlıklı çalışır)
            const now = new Date();
            const thisMonth = now.getMonth();
            const thisYear = now.getFullYear();

            const watchedThisMonth = movies.filter(m => {
                if (!m.watched || !m.watchedDate) return false;
                const d = new Date(m.watchedDate);
                return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
            }).length;

            const watchedThisYear = movies.filter(m => {
                if (!m.watched || !m.watchedDate) return false;
                const d = new Date(m.watchedDate);
                return d.getFullYear() === thisYear;
            }).length;

            const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

            // Tür bazlı kırılım - her filmin genre alanı "Aksiyon, Macera, Komedi" gibi virgülle ayrılmış olabilir
            const genreCounts = {};
            const genreWatchedCounts = {};

            movies.forEach(movie => {
                if (!movie.genre) return;
                const genres = movie.genre.split(',').map(g => g.trim()).filter(Boolean);
                genres.forEach(genre => {
                    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
                    if (movie.watched) {
                        genreWatchedCounts[genre] = (genreWatchedCounts[genre] || 0) + 1;
                    }
                });
            });

            const sortedGenres = Object.keys(genreCounts).sort((a, b) => genreCounts[b] - genreCounts[a]);

            const genreRows = sortedGenres.map(genre => {
                const count = genreCounts[genre];
                const watchedCount = genreWatchedCounts[genre] || 0;
                const barWidth = total > 0 ? Math.round((count / total) * 100) : 0;
                return `
                    <div style="margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.95em;">
                            <span style="color: #e0e0e0;">${genre}</span>
                            <span style="color: #999;">${watchedCount}/${count} izlendi</span>
                        </div>
                        <div style="background: #1a1a1a; border-radius: 6px; height: 10px; overflow: hidden;">
                            <div style="background: linear-gradient(135deg, #d4af37, #f0d77d); height: 100%; width: ${barWidth}%;"></div>
                        </div>
                    </div>
                `;
            }).join('');

            const pieChartSvg = buildGenrePieChart(sortedGenres, genreCounts);

            statsPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <h3 style="color: #d4af37; margin-bottom: 20px;">📊 İzleme İstatistikleri</h3>
                    
                    <div style="text-align: center; margin-bottom: 25px; padding: 20px; background: #1a1a1a; border-radius: 8px;">
                        <div style="font-size: 2.2em; font-weight: 700; color: #d4af37;">${watched} / ${total}</div>
                        <div style="color: #999; margin-top: 5px;">filmden ${watched} tanesi izlendi (%${percentage})</div>
                    </div>

                    <div style="display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 130px; text-align: center; padding: 15px; background: #1a1a1a; border-radius: 8px;">
                            <div style="font-size: 1.6em; font-weight: 700; color: #d4af37;">${watchedThisMonth}</div>
                            <div style="color: #999; font-size: 0.85em; margin-top: 4px;">${monthNames[thisMonth]} ayında izlendi</div>
                        </div>
                        <div style="flex: 1; min-width: 130px; text-align: center; padding: 15px; background: #1a1a1a; border-radius: 8px;">
                            <div style="font-size: 1.6em; font-weight: 700; color: #d4af37;">${watchedThisYear}</div>
                            <div style="color: #999; font-size: 0.85em; margin-top: 4px;">${thisYear} yılında izlendi</div>
                        </div>
                    </div>

                    ${sortedGenres.length > 0 ? `
                    <h4 style="color: #e0e0e0; margin-bottom: 15px; text-align: center;">Tür Dağılımı</h4>
                    <div style="display: flex; justify-content: center; margin-bottom: 25px;">
                        ${pieChartSvg}
                    </div>
                    ` : ''}

                    <h4 style="color: #e0e0e0; margin-bottom: 15px;">Tür Bazlı Dağılım (Detaylı)</h4>
                    ${sortedGenres.length > 0 ? genreRows : '<p style="color: #999;">Henüz tür bilgisi olan film yok</p>'}

                    <button class="modal-btn secondary" style="width: 100%; margin-top: 15px;" onclick="closeStatsPanel()">Kapat</button>
                </div>
            `;

            statsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            pushUiState(closeStatsPanel);
        }

        // Tür dağılımı için basit bir SVG pasta grafik oluşturma
        function buildGenrePieChart(sortedGenres, genreCounts) {
            const colors = ['#d4af37', '#9b7ff0', '#00f0a0', '#ff5576', '#4fb8d4', '#f0a05a', '#c4d44f', '#d44fb8', '#8a8a8a', '#5a8fd4'];
            const totalCount = sortedGenres.reduce((sum, g) => sum + genreCounts[g], 0);

            if (totalCount === 0) return '';

            const radius = 70;
            const cx = 90, cy = 90;
            let cumulativeAngle = -90; // 12 yönünden başla

            const slices = sortedGenres.map((genre, i) => {
                const value = genreCounts[genre];
                const angle = (value / totalCount) * 360;
                const startAngle = cumulativeAngle;
                const endAngle = cumulativeAngle + angle;
                cumulativeAngle = endAngle;

                const startRad = (startAngle * Math.PI) / 180;
                const endRad = (endAngle * Math.PI) / 180;

                const x1 = cx + radius * Math.cos(startRad);
                const y1 = cy + radius * Math.sin(startRad);
                const x2 = cx + radius * Math.cos(endRad);
                const y2 = cy + radius * Math.sin(endRad);

                const largeArc = angle > 180 ? 1 : 0;
                const color = colors[i % colors.length];

                const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

                return { path, color };
            });

            const pathsHtml = slices.map(s => `<path d="${s.path}" fill="${s.color}" stroke="#2a2a2a" stroke-width="2"></path>`).join('');

            const legendHtml = sortedGenres.map((genre, i) => `
                <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8em; color: #ccc; margin-bottom: 4px;">
                    <span style="width: 10px; height: 10px; border-radius: 2px; background: ${colors[i % colors.length]}; display: inline-block;"></span>
                    <span>${genre} (${genreCounts[genre]})</span>
                </div>
            `).join('');

            return `
                <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">
                    <svg width="180" height="180" viewBox="0 0 180 180">${pathsHtml}</svg>
                    <div>${legendHtml}</div>
                </div>
            `;
        }

        function closeStatsPanel(fromHistory) {
            statsPanel.style.display = 'none';
            statsPanel.innerHTML = '';
            if (!fromHistory) popUiStateIfMatch(closeStatsPanel);
        }

        // ============ ÖNERİ SİSTEMİ (Bana Öner) ============
        const recommendPanel = document.getElementById('recommendPanel');

        // Ana giriş noktası: "Bana Öner" butonuna basılınca önce mod seçimi gösterilir
        function showRecommendations() {
            const wasAlreadyOpen = recommendPanel.style.display === 'block';
            movieListPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            recommendPanel.style.display = 'block';
            if (!wasAlreadyOpen) pushUiState(closeRecommendPanel);

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <h3 style="color: #d4af37; margin-bottom: 10px;">🎯 Nasıl Öneri İstersin?</h3>
                    <p style="color: #999; margin-bottom: 20px; font-size: 0.9em;">İki farklı şekilde öneri alabilirsiniz:</p>

                    <div onclick="showHistoryBasedRecommendations()" style="background: #1a1a1a; border-radius: 10px; padding: 18px; margin-bottom: 12px; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s;" onmouseover="this.style.borderColor='#d4af37'" onmouseout="this.style.borderColor='transparent'">
                        <div style="font-size: 1.5em; margin-bottom: 8px;">📊</div>
                        <div style="font-weight: 600; color: #d4af37; margin-bottom: 4px;">Geçmişime Göre Öner</div>
                        <div style="font-size: 0.85em; color: #999;">Kütüphanenizdeki film ve dizilerinize bakıp, zevkinize uygun otomatik öneri sunar.</div>
                    </div>

                    <div onclick="showFilterBasedRecommendations()" style="background: #1a1a1a; border-radius: 10px; padding: 18px; margin-bottom: 15px; cursor: pointer; border: 2px solid transparent; transition: border-color 0.2s;" onmouseover="this.style.borderColor='#9b7ff0'" onmouseout="this.style.borderColor='transparent'">
                        <div style="font-size: 1.5em; margin-bottom: 8px;">🎛️</div>
                        <div style="font-weight: 600; color: #9b7ff0; margin-bottom: 4px;">Filtreleyerek Bul</div>
                        <div style="font-size: 0.85em; color: #999;">Tür, ruh hali, dönem gibi etiketler seçip o ana özel bir öneri alın.</div>
                    </div>

                    <button class="modal-btn secondary" style="width: 100%;" onclick="closeRecommendPanel()">Kapat</button>
                </div>
            `;
            recommendPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        // ============ MOD 1: GEÇMİŞE GÖRE ÖNERİ ============
        async function showHistoryBasedRecommendations() {
            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px; text-align: center;">
                    <div class="loading-spinner" style="margin: 20px auto;"></div>
                    <p style="color: #999;">Gemini önerilerinizi hazırlıyor...</p>
                </div>
            `;
            recommendPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // En çok geçen tür, yönetmen ve oyuncuyu bul - HEM FİLMLER HEM DİZİLER hesaba katılır,
            // izlenmiş olma şartı yok (kütüphaneye eklenen her şey sayılır)
            const genreCounts = {};
            const directorCounts = {};
            const actorCounts = {};

            const countFromItem = (item) => {
                if (item.genre) {
                    item.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
                        genreCounts[g] = (genreCounts[g] || 0) + 1;
                    });
                }
                if (item.director) {
                    item.director.split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
                        directorCounts[d] = (directorCounts[d] || 0) + 1;
                    });
                }
                if (item.actors) {
                    item.actors.split(',').map(a => a.trim()).filter(Boolean).forEach(a => {
                        actorCounts[a] = (actorCounts[a] || 0) + 1;
                    });
                }
            };

            movies.forEach(countFromItem);
            series.forEach(countFromItem);

            const sortByCount = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a]);

            const favoriteGenre = sortByCount(genreCounts)[0] || null;
            const favoriteDirector = sortByCount(directorCounts)[0] || null;
            const favoriteActor = sortByCount(actorCounts)[0] || null;

            // Kütüphanedeki (film + dizi) tüm isimler - öneriler bunlarla eşleşirse elenir
            const existingTitles = new Set([
                ...movies.map(m => m.name.toLowerCase()),
                ...series.map(s => s.name.toLowerCase())
            ]);

            let results = [];
            let usedGeminiInfo = null;
            let recommendationError = null;

            if (!favoriteDirector && !favoriteActor && !favoriteGenre) {
                recommendationError = 'Henüz kütüphanenizde film veya dizi yok. Öneri alabilmek için önce birkaç film/dizi ekleyin.';
            } else {
                let prompt = 'Bana film veya dizi önerileri yap. ';
                if (favoriteDirector) prompt += `En çok karşılaştığım yönetmen/yaratıcı ${favoriteDirector}. `;
                if (favoriteActor) prompt += `En çok karşılaştığım oyuncu ${favoriteActor}. `;
                if (favoriteGenre) prompt += `En sevdiğim tür ${favoriteGenre}. `;
                prompt += 'Bu zevkime uygun, benzer tarzda 6 film veya dizi öner (ikisi karışık olabilir).';

                const titles = await askGeminiForMovieTitles(prompt, 6);

                if (!titles || titles.length === 0) {
                    recommendationError = 'Gemini\'den öneri alınamadı: ' + lastGeminiDebugInfo;
                } else {
                    for (const title of titles) {
                        try {
                            // type filtresi YOK - hem film hem dizi sonucu gelebilir
                            const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_API}`);
                            const item = await response.json();
                            if (item.Response !== 'False' && !existingTitles.has(item.Title.toLowerCase())) {
                                results.push(item);
                            }
                        } catch (e) { /* devam et */ }
                    }

                    if (results.length > 0) {
                        usedGeminiInfo = { favoriteDirector, favoriteActor, favoriteGenre };
                    } else {
                        recommendationError = 'Gemini öneriler verdi ama hepsi zaten kütüphanenizde veya OMDb\'de bulunamadı. Tekrar deneyin.';
                    }
                }
            }

            renderRecommendations(results, favoriteGenre, usedGeminiInfo, recommendationError);
        }

        function renderRecommendations(results, favoriteGenre, geminiInfo, recommendationError) {
            let introText;
            if (geminiInfo) {
                const parts = [];
                if (geminiInfo.favoriteDirector) parts.push(`yönetmen/yaratıcı <strong style="color:#d4af37;">${geminiInfo.favoriteDirector}</strong>`);
                if (geminiInfo.favoriteActor) parts.push(`oyuncu <strong style="color:#d4af37;">${geminiInfo.favoriteActor}</strong>`);
                if (geminiInfo.favoriteGenre) parts.push(`<strong style="color:#d4af37;">${geminiInfo.favoriteGenre}</strong> türü`);
                introText = `✨ Gemini, kütüphanenizde en çok yer alan ${parts.join(', ')} zevkinize göre bu önerileri hazırladı:`;
            } else if (favoriteGenre) {
                introText = `Kütüphanenizde en çok yer alan tür <strong style="color:#d4af37;">${favoriteGenre}</strong> olduğu için, bu türden öneriler hazırladık:`;
            } else {
                introText = `İşte sizin için bazı öneriler:`;
            }

            const cardsHtml = results.length > 0 ? results.map(item => {
                const isSeries = item.Type === 'series';
                const typeTag = isSeries
                    ? '<span style="color:#9b7ff0;">📺 Dizi</span>'
                    : '<span style="color:#d4af37;">🎬 Film</span>';
                return `
                <div style="background: #1a1a1a; border-radius: 8px; padding: 15px; margin-bottom: 12px; display: flex; gap: 12px; align-items: center;">
                    <div style="width: 60px; height: 85px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                        ${item.Poster !== 'N/A' ? `<img src="${item.Poster}" style="width: 100%; height: 100%; object-fit: cover;">` : (isSeries ? '📺' : '🎬')}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #e0e0e0;">${item.Title}</div>
                        <div style="font-size: 0.85em; color: #999; margin: 4px 0;">${item.Year} · ⭐ ${item.imdbRating !== 'N/A' ? item.imdbRating : '?'} · ${typeTag}</div>
                        <div style="font-size: 0.8em; color: #777;">${item.Genre}</div>
                    </div>
                    <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 14px; font-size: 0.85em;" onclick="quickAddFromRecommendation('${item.imdbID}')">Ekle</button>
                </div>
            `;
            }).join('') : `<p style="color: #ff5576; text-align: center; font-size: 0.9em;">${recommendationError || 'Şu an öneri bulunamadı.'}</p>`;

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <button onclick="showRecommendations()" style="background: none; border: none; color: #999; font-size: 0.85em; cursor: pointer; margin-bottom: 10px; padding: 0;">← Geri</button>
                    <h3 style="color: #d4af37; margin-bottom: 10px;">📊 Geçmişime Göre Öneriler</h3>
                    <p style="color: #999; margin-bottom: 20px; font-size: 0.9em;">${introText}</p>
                    ${cardsHtml}
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="modal-btn secondary" style="flex: 1;" onclick="showHistoryBasedRecommendations()">🔄 Yeni Öneriler</button>
                        <button class="modal-btn secondary" style="flex: 1;" onclick="closeRecommendPanel()">Kapat</button>
                    </div>
                </div>
            `;
        }

        async function quickAddFromRecommendation(imdbID) {
            // Not: recommendPanel'i gizlemiyoruz, arkada açık kalıyor.
            // Modal kapatıldığında (Kapat butonu veya geri tuşu ile) kullanıcı
            // otomatik olarak öneri listesine geri dönmüş olacak.
            // selectMovie, gelen öğenin film mi dizi mi olduğunu otomatik algılar.
            openModal();
            await selectMovie(imdbID);
        }

        function closeRecommendPanel(fromHistory) {
            recommendPanel.style.display = 'none';
            recommendPanel.innerHTML = '';
            if (!fromHistory) popUiStateIfMatch(closeRecommendPanel);
        }

        // ============ MOD 2: FİLTRELEYEREK BUL ============

        const FILTER_CATEGORIES = {
            type: {
                label: '🎬 Film / Dizi',
                multi: false,
                options: ['Film', 'Dizi', 'Mini Dizi']
            },
            genre: {
                label: '🎭 Tür',
                multi: true,
                options: ['Bilim Kurgu', 'Aksiyon', 'Komedi', 'Romantik', 'Korku', 'Gerilim', 'Drama', 'Macera', 'Fantastik', 'Animasyon', 'Suç', 'Tarihi', 'Belgesel']
            },
            mood: {
                label: '😊 Ruh Hali',
                multi: true,
                options: ['Neşeli', 'Hüzünlü', 'Heyecanlı', 'Sakin', 'Gerilimli', 'Düşündürücü', 'Romantik', 'Karanlık']
            },
            list: {
                label: '🏆 Liste / Prestij',
                multi: true,
                options: ['Oscar Ödüllü', 'IMDb En İyi 250', 'En Çok İzlenen', 'Eleştirmen Beğenisi Yüksek', 'Az Bilinen Hazineler', 'Yeni Çıkanlar', 'Klasikleşmiş Kült']
            },
            origin: {
                label: '🌐 Köken',
                multi: false,
                options: ['Yerli Yapım', 'Yabancı Yapım']
            },
            duration: {
                label: '⏱️ Süre',
                multi: false,
                options: ['Kısa (~90 dk altı)', 'Standart (90-150 dk)', 'Uzun (150 dk+)']
            },
            era: {
                label: '📅 Dönem',
                multi: false,
                options: ['Klasik (2000 öncesi)', 'Modern (2000-2015)', 'Güncel (2015+)']
            }
        };

        let selectedFilters = {}; // { genre: ['Bilim Kurgu', 'Gerilim'], mood: ['Heyecanlı'], ... }
        let selectedActorFilter = '';
        let openFilterCategory = null; // Hangi kategori şu an açık (alt etiketleri gösteriliyor)

        function showFilterBasedRecommendations() {
            selectedFilters = {};
            selectedActorFilter = '';
            openFilterCategory = null;
            renderFilterScreen();
        }

        function renderFilterScreen() {
            const categoryButtonsHtml = Object.keys(FILTER_CATEGORIES).map(key => {
                const cat = FILTER_CATEGORIES[key];
                const selectedCount = (selectedFilters[key] || []).length;
                const isOpen = openFilterCategory === key;
                return `
                    <button onclick="toggleFilterCategory('${key}')" style="background: ${selectedCount > 0 ? '#9b7ff0' : (isOpen ? '#404040' : '#2a2a2a')}; color: ${selectedCount > 0 ? '#1a1a1a' : '#e0e0e0'}; border: 1px solid #404040; border-radius: 20px; padding: 8px 14px; font-size: 0.85em; cursor: pointer; margin: 4px;">
                        ${cat.label}${selectedCount > 0 ? ' (' + selectedCount + ')' : ''}
                    </button>
                `;
            }).join('');

            let optionsHtml = '';
            if (openFilterCategory) {
                const cat = FILTER_CATEGORIES[openFilterCategory];
                const currentSelection = selectedFilters[openFilterCategory] || [];

                optionsHtml = `
                    <div style="background: #1a1a1a; border-radius: 8px; padding: 14px; margin-top: 10px; margin-bottom: 10px;">
                        <div style="color: #999; font-size: 0.8em; margin-bottom: 10px;">${cat.multi ? 'Birden fazla seçebilirsiniz' : 'Tek seçim yapabilirsiniz'}</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${cat.options.map(opt => {
                                const isSelected = currentSelection.includes(opt);
                                return `
                                    <button onclick="toggleFilterOption('${openFilterCategory}', '${opt.replace(/'/g, "\\'")}')" style="background: ${isSelected ? '#d4af37' : '#2a2a2a'}; color: ${isSelected ? '#1a1a1a' : '#ccc'}; border: 1px solid #404040; border-radius: 16px; padding: 6px 12px; font-size: 0.8em; cursor: pointer;">
                                        ${opt}
                                    </button>
                                `;
                            }).join('')}
                        </div>

                        ${openFilterCategory === 'type' && currentSelection.includes('Dizi') ? `
                            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #333;">
                                <button onclick="toggleFilterOption('type', 'Mini Dizi')" style="background: ${currentSelection.includes('Mini Dizi') ? '#d4af37' : '#2a2a2a'}; color: ${currentSelection.includes('Mini Dizi') ? '#1a1a1a' : '#ccc'}; border: 1px solid #404040; border-radius: 16px; padding: 6px 12px; font-size: 0.8em; cursor: pointer;">
                                    Mini Dizi (sınırlı bölümlü)
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;
            }

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <button onclick="showRecommendations()" style="background: none; border: none; color: #999; font-size: 0.85em; cursor: pointer; margin-bottom: 10px; padding: 0;">← Geri</button>
                    <h3 style="color: #9b7ff0; margin-bottom: 10px;">🎛️ Filtreleyerek Bul</h3>
                    <p style="color: #999; margin-bottom: 15px; font-size: 0.85em;">İstediğiniz etiketleri seçin (hiç seçmezseniz o kategori serbest kalır):</p>

                    <div style="display: flex; flex-wrap: wrap; margin: -4px;">${categoryButtonsHtml}</div>
                    ${optionsHtml}

                    <div style="margin-top: 15px;">
                        <label style="color: #999; font-size: 0.8em; display: block; margin-bottom: 6px;">🌟 Belirli bir oyuncu (isteğe bağlı)</label>
                        <input type="text" id="actorFilterInput" value="${selectedActorFilter}" oninput="selectedActorFilter = this.value" placeholder="Örn: Tom Hanks" style="width: 100%; padding: 8px 10px; background: #1a1a1a; border: 2px solid #404040; color: #e0e0e0; border-radius: 6px; box-sizing: border-box;">
                    </div>

                    <button class="modal-btn primary" style="width: 100%; margin-top: 18px; background: #9b7ff0;" onclick="runFilterSearch()">🔍 Bul</button>
                    <button class="modal-btn secondary" style="width: 100%; margin-top: 8px;" onclick="closeRecommendPanel()">Kapat</button>
                </div>
            `;
        }

        function toggleFilterCategory(key) {
            openFilterCategory = (openFilterCategory === key) ? null : key;
            renderFilterScreen();
        }

        function toggleFilterOption(categoryKey, option) {
            const cat = FILTER_CATEGORIES[categoryKey];
            if (!selectedFilters[categoryKey]) selectedFilters[categoryKey] = [];

            const list = selectedFilters[categoryKey];
            const idx = list.indexOf(option);

            if (idx !== -1) {
                // Zaten seçiliyse, kaldır
                list.splice(idx, 1);
            } else {
                if (cat.multi) {
                    list.push(option);
                } else {
                    // Tekli seçim - öncekini değiştir
                    selectedFilters[categoryKey] = [option];
                }
            }

            if (selectedFilters[categoryKey].length === 0) delete selectedFilters[categoryKey];
            renderFilterScreen();
        }

        async function runFilterSearch() {
            // Seçimlerden Gemini prompt'u oluştur
            const parts = [];

            if (selectedFilters.type && selectedFilters.type.length > 0) {
                parts.push(selectedFilters.type.join(' veya ') + ' türünde içerik');
            } else {
                parts.push('film veya dizi');
            }
            if (selectedFilters.genre) parts.push(selectedFilters.genre.join(', ') + ' türünde');
            if (selectedFilters.mood) parts.push(selectedFilters.mood.join(', ') + ' bir ruh haline uygun');
            if (selectedFilters.list) parts.push(selectedFilters.list.join(', ') + ' kategorisine uyan');
            if (selectedFilters.origin) parts.push(selectedFilters.origin[0] === 'Yerli Yapım' ? 'Türk yapımı' : 'yabancı yapım');
            if (selectedFilters.duration) parts.push('süre olarak ' + selectedFilters.duration[0]);
            if (selectedFilters.era) parts.push(selectedFilters.era[0] + ' döneminden');
            if (selectedActorFilter && selectedActorFilter.trim()) parts.push(selectedActorFilter.trim() + ' oyuncusunun oynadığı');

            const prompt = 'Bana ' + parts.join(', ') + ' 6 öneri ver.';

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px; text-align: center;">
                    <div class="loading-spinner" style="margin: 20px auto;"></div>
                    <p style="color: #999;">Gemini seçimlerinize göre arıyor...</p>
                </div>
            `;
            recommendPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

            const existingTitles = new Set([
                ...movies.map(m => m.name.toLowerCase()),
                ...series.map(s => s.name.toLowerCase())
            ]);

            const titles = await askGeminiForMovieTitles(prompt, 6);
            let results = [];
            let filterError = null;

            if (!titles || titles.length === 0) {
                filterError = 'Gemini\'den öneri alınamadı: ' + lastGeminiDebugInfo;
            } else {
                for (const title of titles) {
                    try {
                        const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_API}`);
                        const item = await response.json();
                        if (item.Response !== 'False' && !existingTitles.has(item.Title.toLowerCase())) {
                            results.push(item);
                        }
                    } catch (e) { /* devam et */ }
                }

                if (results.length === 0) {
                    filterError = 'Gemini öneriler verdi ama hepsi zaten kütüphanenizde veya OMDb\'de bulunamadı. Tekrar deneyin.';
                }
            }

            renderFilterResults(results, filterError);
        }

        function renderFilterResults(results, filterError) {
            const cardsHtml = results.length > 0 ? results.map(item => {
                const isSeries = item.Type === 'series';
                const typeTag = isSeries
                    ? '<span style="color:#9b7ff0;">📺 Dizi</span>'
                    : '<span style="color:#d4af37;">🎬 Film</span>';
                return `
                <div style="background: #1a1a1a; border-radius: 8px; padding: 15px; margin-bottom: 12px; display: flex; gap: 12px; align-items: center;">
                    <div style="width: 60px; height: 85px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                        ${item.Poster !== 'N/A' ? `<img src="${item.Poster}" style="width: 100%; height: 100%; object-fit: cover;">` : (isSeries ? '📺' : '🎬')}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #e0e0e0;">${item.Title}</div>
                        <div style="font-size: 0.85em; color: #999; margin: 4px 0;">${item.Year} · ⭐ ${item.imdbRating !== 'N/A' ? item.imdbRating : '?'} · ${typeTag}</div>
                        <div style="font-size: 0.8em; color: #777;">${item.Genre}</div>
                    </div>
                    <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 14px; font-size: 0.85em;" onclick="quickAddFromRecommendation('${item.imdbID}')">Ekle</button>
                </div>
            `;
            }).join('') : `<p style="color: #ff5576; text-align: center; font-size: 0.9em;">${filterError || 'Şu an öneri bulunamadı.'}</p>`;

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <button onclick="renderFilterScreen()" style="background: none; border: none; color: #999; font-size: 0.85em; cursor: pointer; margin-bottom: 10px; padding: 0;">← Filtreleri Düzenle</button>
                    <h3 style="color: #9b7ff0; margin-bottom: 15px;">🎛️ Seçimlerinize Uygun Öneriler</h3>
                    ${cardsHtml}
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="modal-btn secondary" style="flex: 1;" onclick="runFilterSearch()">🔄 Yeni Öneriler</button>
                        <button class="modal-btn secondary" style="flex: 1;" onclick="closeRecommendPanel()">Kapat</button>
                    </div>
                </div>
            `;
        }

        // Modal Yönetimi
        function openModal() {
            movieForm.reset();
            document.getElementById('moviePreviewArea').innerHTML = '';
            document.getElementById('movieNameTRGroup').style.display = 'none';
            document.getElementById('myRatingGroup').style.display = 'none';
            document.getElementById('modalHeaderTitle').textContent = 'Film/Dizi Ekle';
            document.getElementById('mainSaveBtn').style.background = '';
            modal.classList.add('active');
            document.getElementById('movieSearch').focus();
            pushUiState(closeModal);
        }

        function closeModal(fromHistory) {
            modal.classList.remove('active');
            movieForm.reset();
            document.getElementById('moviePreviewArea').innerHTML = '';
            document.getElementById('movieNameTRGroup').style.display = 'none';
            document.getElementById('myRatingGroup').style.display = 'none';
            searchSuggestions.classList.remove('active');
            delete movieForm.dataset.posterUrl;
            delete movieForm.dataset.actors;
            delete movieForm.dataset.writer;
            delete movieForm.dataset.runtime;
            delete movieForm.dataset.rated;
            delete movieForm.dataset.released;
            delete movieForm.dataset.language;
            delete movieForm.dataset.country;
            delete movieForm.dataset.awards;
            delete movieForm.dataset.boxoffice;
            delete movieForm.dataset.rottenTomatoes;
            delete movieForm.dataset.metacritic;
            delete movieForm.dataset.type;
            delete movieForm.dataset.imdbID;
            delete movieForm.dataset.seasonsData;
            delete movieForm.dataset.totalSeasons;
            if (!fromHistory) popUiStateIfMatch(closeModal);

            // Eğer bu modal, bir detay ekranındaki "Diğer Filmleri/Dizileri" sonuçlarından
            // açıldıysa, kapanınca o detay ekranına (ve içindeki sonuçlara) geri dön.
            if (hiddenDetailModalPending) {
                hiddenDetailModalPending = false;
                detailModal.classList.add('active');
                pushUiState(closeDetailModal);
            } else if (hiddenSeriesDetailModalPending) {
                hiddenSeriesDetailModalPending = false;
                seriesDetailModal.classList.add('active');
                pushUiState(closeSeriesDetailModal);
            }
        }

        // Film Detay Modalı
        const detailModal = document.getElementById('detailModal');
        const detailModalContent = document.getElementById('detailModalContent');

        function openDetailModal(id) {
            renderDetailModalContent(id);
            detailModal.classList.add('active');
            pushUiState(closeDetailModal);
        }

        // Sadece içeriği render eder, modalı açmaz/history'e dokunmaz.
        // Modal zaten açıkken içeriği güncellemek için kullanılır (örn. Türkçe ad kaydedilince).
        function renderDetailModalContent(id) {
            const movie = movies.find(m => m.id === id);
            if (!movie) return;

            detailModalContent.innerHTML = `
                <div style="text-align: center; margin-bottom: 15px;">
                    <div style="width: 100%; max-height: 320px; border-radius: 8px; overflow: hidden; background: #1a1a1a; display: flex; align-items: center; justify-content: center;">
                        ${movie.posterUrl 
                            ? `<img src="${movie.posterUrl}" alt="${movie.name}" style="width: 100%; object-fit: contain; max-height: 320px;">` 
                            : `<span style="font-size: 4em; padding: 60px 0;">🎬</span>`
                        }
                    </div>
                </div>
                <h2 style="color: #d4af37; margin-bottom: 5px;">${movie.nameTR || movie.name}</h2>
                ${movie.nameTR && movie.nameTR !== movie.name ? `<p style="color: #999; font-size: 0.9em; margin-bottom: 15px;">Orijinal Adı: ${movie.name}</p>` : '<div style="margin-bottom: 15px;"></div>'}

                <div style="margin-bottom: 15px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 6px;">🇹🇷 Türkçe Adı</div>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="detailNameTR" value="${movie.nameTR || movie.name}" placeholder="Türkçe adını yazın" style="flex: 1; padding: 8px 10px; background: #1a1a1a; border: 2px solid #404040; color: #e0e0e0; border-radius: 6px;">
                        <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 16px;" onclick="saveDetailNameTR(${movie.id})">Kaydet</button>
                    </div>
                </div>
                
                <div style="display: flex; gap: 15px; margin-bottom: 15px; flex-wrap: wrap;">
                    <span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">📅 ${movie.year}</span>
                    ${movie.runtime ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">⏱️ ${movie.runtime}</span>` : ''}
                    ${movie.rated ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">🔞 ${movie.rated}</span>` : ''}
                    ${movie.rating && movie.rating !== 'N/A' ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">⭐ IMDb: ${movie.rating}</span>` : ''}
                    ${movie.rottenTomatoes ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">🍅 ${movie.rottenTomatoes}</span>` : ''}
                    ${movie.metacritic ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">Ⓜ️ ${movie.metacritic}</span>` : ''}
                    <span style="background: ${movie.watched ? '#00f0a020' : '#1a1a1a'}; color: ${movie.watched ? '#00f0a0' : '#e0e0e0'}; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">${movie.watched ? '✓ İzlendi' : 'İzlenmedi'}</span>
                </div>

                <div style="margin-bottom: 15px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 6px;">🌟 Kendi Puanım</div>
                    <div style="display: flex; gap: 8px;">
                        <input type="number" id="detailMyRating" min="1" max="10" step="0.1" value="${movie.myRating || ''}" placeholder="Ör: 8.5" style="flex: 1; padding: 8px 10px; background: #1a1a1a; border: 2px solid #404040; color: #e0e0e0; border-radius: 6px;">
                        <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 16px;" onclick="saveMyRating(${movie.id})">Kaydet</button>
                    </div>
                </div>

                <div style="margin-bottom: 12px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">Tür</div>
                    <div style="color: #ccc;">${movie.genre || 'Belirtilmemiş'}</div>
                </div>

                <div style="margin-bottom: 12px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">Yönetmen</div>
                    <div style="color: #ccc; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span>${movie.director || 'Belirtilmemiş'}</span>
                        ${movie.director && movie.director !== 'Belirtilmemiş' ? `<button class="modal-btn secondary" style="flex: 0 0 auto; padding: 5px 12px; font-size: 0.8em;" onclick="showDirectorMovies('${movie.director.split(',')[0].trim().replace(/'/g, "\\'")}')">🎬 Diğer Filmleri</button>` : ''}
                    </div>
                </div>

                <div id="directorMoviesResult"></div>

                ${movie.writer ? `
                <div style="margin-bottom: 12px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">Senarist</div>
                    <div style="color: #ccc;">${movie.writer}</div>
                </div>` : ''}

                ${movie.actors ? `
                <div style="margin-bottom: 12px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">🎭 Oyuncular</div>
                    <div style="color: #ccc;">${movie.actors}</div>
                </div>` : ''}

                <div style="margin-bottom: 20px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">Konusu</div>
                    <div style="color: #ccc; line-height: 1.5;">${movie.plot || 'Açıklama yok'}</div>
                </div>

                ${movie.awards ? `
                <div style="margin-bottom: 12px;">
                    <div style="color: #d4af37; font-weight: 600; margin-bottom: 4px;">🏆 Ödüller</div>
                    <div style="color: #ccc;">${movie.awards}</div>
                </div>` : ''}

                <div style="display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; font-size: 0.85em; color: #999;">
                    ${movie.country ? `<span>🌍 ${movie.country}</span>` : ''}
                    ${movie.language ? `<span>🗣️ ${movie.language}</span>` : ''}
                    ${movie.released ? `<span>🎬 Vizyon: ${movie.released}</span>` : ''}
                    ${movie.boxoffice ? `<span>💰 Gişe: ${movie.boxoffice}</span>` : ''}
                </div>

                <button class="modal-btn secondary" style="width: 100%;" onclick="closeDetailModal()">Kapat</button>
            `;
        }

        function closeDetailModal(fromHistory) {
            detailModal.classList.remove('active');
            if (!fromHistory) popUiStateIfMatch(closeDetailModal);
        }

        // Detay modalından "Ekle" butonuna basılınca: modalı KAPATMIYORUZ, sadece gizliyoruz
        // (içeriği DOM'da saklı kalır - örn. "Diğer Filmleri" sonuçları kaybolmaz).
        // Film Ekle modalı kapatıldığında bu modal otomatik olarak tekrar gösterilir.
        let hiddenDetailModalPending = false;
        let hiddenSeriesDetailModalPending = false;

        function closeDetailModalThenAdd(imdbID) {
            detailModal.classList.remove('active');
            removeFromUiStackSilently(closeDetailModal);
            hiddenDetailModalPending = true;
            openModal();
            selectMovie(imdbID);
        }

        // Aynı yönetmenin diğer filmlerini OMDb'de arayıp gösterme
        async function showDirectorMovies(directorName) {
            const container = document.getElementById('directorMoviesResult');
            if (!container) return;

            container.innerHTML = `
                <div style="text-align: center; padding: 15px;">
                    <div class="loading-spinner"></div>
                    <p style="color: #999; font-size: 0.8em; margin-top: 8px;">Gemini'den öneriler isteniyor...</p>
                </div>
            `;

            try {
                // 1. Gemini'den bu yönetmenin bilinen filmlerinin adlarını iste
                const titles = await askGeminiForMovieTitles(
                    `${directorName} adlı film yönetmeninin en bilinen 6 filmi nedir?`,
                    6
                );

                if (!titles || titles.length === 0) {
                    container.innerHTML = `<p style="color: #999; font-size: 0.85em; margin-bottom: 15px;">Öneri alınamadı, lütfen tekrar deneyin.</p><p style="color:#ff5576; font-size:0.75em; word-break: break-all;">Debug: ${lastGeminiDebugInfo}</p>`;
                    return;
                }

                // 2. Her başlığı OMDb'de arayıp gerçek veri (poster, puan, imdbID) ile eşleştir
                const existingTitles = new Set(movies.map(m => m.name.toLowerCase()));
                const results = [];

                for (const title of titles) {
                    try {
                        const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_API}`);
                        const movie = await response.json();
                        if (movie.Response !== 'False' && !existingTitles.has(movie.Title.toLowerCase())) {
                            results.push(movie);
                        }
                    } catch (e) {
                        // tek bir başlık başarısız olursa diğerlerine devam et
                    }
                }

                if (results.length === 0) {
                    container.innerHTML = `<p style="color: #999; font-size: 0.85em; margin-bottom: 15px;">Zaten kütüphanenizde olabilirler veya bulunamadı.</p>`;
                    return;
                }

                container.innerHTML = `
                    <div style="margin-top: 10px; margin-bottom: 15px;">
                        <div style="color: #999; font-size: 0.8em; margin-bottom: 8px;">✨ Gemini'nin önerdiği "${directorName}" filmleri:</div>
                        ${results.map(m => `
                            <div style="display: flex; gap: 10px; align-items: center; background: #1a1a1a; border-radius: 6px; padding: 8px; margin-bottom: 6px;">
                                <div style="width: 36px; height: 52px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                                    ${m.Poster !== 'N/A' ? `<img src="${m.Poster}" style="width: 100%; height: 100%; object-fit: cover;">` : '<span style="font-size: 1em;">🎬</span>'}
                                </div>
                                <span style="flex: 1; font-size: 0.9em; color: #ccc;">${m.Title} (${m.Year}) ${m.imdbRating !== 'N/A' ? '⭐' + m.imdbRating : ''}</span>
                                <button class="modal-btn primary" style="flex: 0 0 auto; padding: 4px 10px; font-size: 0.8em;" onclick="closeDetailModalThenAdd('${m.imdbID}')">Ekle</button>
                            </div>
                        `).join('')}
                    </div>
                `;
            } catch (error) {
                console.error('Yönetmen filmleri arama hatası:', error);
                container.innerHTML = `<p style="color: #ff5576; font-size: 0.85em;">Arama sırasında hata oluştu.</p>`;
            }
        }

        function saveMyRating(id) {
            const movie = movies.find(m => m.id === id);
            if (!movie) return;

            const input = document.getElementById('detailMyRating');
            const value = input.value.trim();

            movie.myRating = value || null;
            saveMovies();
            renderMovies();
            syncMoviesToDrive();
            showToast('Puanınız kaydedildi! ⭐');
        }

        function saveDetailNameTR(id) {
            const movie = movies.find(m => m.id === id);
            if (!movie) return;

            const input = document.getElementById('detailNameTR');
            const value = input.value.trim();

            movie.nameTR = value || movie.name;
            saveMovies();
            renderMovies();
            renderDetailModalContent(id); // Sadece içeriği yenile, modalı yeniden açma/history bozma
            syncMoviesToDrive();
            showToast('Türkçe ad kaydedildi! 🇹🇷');
        }

        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) closeDetailModal();
        });

        // LocalStorage'a Kaydet
        function saveMovies() {
            localStorage.setItem('filmKutuphanesi', JSON.stringify(movies));
        }

        function saveSeries() {
            localStorage.setItem('seriesKutuphanesi', JSON.stringify(series));
        }

        // Google Drive'a Senkronize Et
        async function syncMoviesToDrive() {
            if (!appsScriptUrl || !googleIdToken) return;

            syncIndicator.classList.add('syncing');
            syncText.textContent = 'Senkronize ediliyor...';

            try {
                const response = await fetch(appsScriptUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain;charset=utf-8'
                    },
                    body: JSON.stringify({
                        idToken: googleIdToken,
                        movies: movies
                    })
                });

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || 'Bilinmeyen hata');
                }

                syncIndicator.classList.remove('syncing', 'error');
                syncIndicator.classList.add('pulse');
                syncText.textContent = 'Senkronize edildi ✓';
                
                setTimeout(() => {
                    if (syncText.textContent === 'Senkronize edildi ✓') {
                        syncText.textContent = 'Senkronizasyon aktif';
                        syncIndicator.classList.remove('pulse');
                    }
                }, 3000);
            } catch (error) {
                console.error('Senkronizasyon hatası:', error);
                syncIndicator.classList.remove('syncing');
                syncIndicator.classList.add('error');
                syncText.textContent = 'Hata: ' + error.message;
            }
        }

        // Bildirim
        function showToast(message) {
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'slideDown 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 2500);
        }

        // Başlatma (sadece giriş yapıldıktan sonra çalışır)
        async function initAppAfterLogin() {
            renderMovies();
            updateStats();
            renderSeriesStats();
            await loadMoviesFromDrive();
        }

        // Drive'daki Google Sheet'ten film verilerini çekip yerel listeyi günceller
        async function loadMoviesFromDrive() {
            if (!appsScriptUrl || !googleIdToken) return;

            syncIndicator.classList.add('syncing');
            syncText.textContent = 'Drive\'dan yükleniyor...';

            try {
                // ÖNEMLİ: Token'ı GET/URL parametresi olarak DEĞİL, POST body'sinde gönderiyoruz.
                // Google ID token'ları çok uzun (1000+ karakter) olduğundan URL'ye eklenince
                // kesilebilir/bozulabilir ve "invalid_token" hatasına yol açabilir.
                // POST body'sinde uzunluk sınırı yoktur, bu yöntem güvenilirdir.
                const response = await fetch(appsScriptUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        idToken: googleIdToken,
                        action: 'load'
                    })
                });

                const rawText = await response.text();

                if (!rawText || rawText.trim().length === 0) {
                    throw new Error('Drive\'dan boş yanıt geldi (içerik yok)');
                }

                let result;
                try {
                    result = JSON.parse(rawText);
                } catch (parseErr) {
                    throw new Error('Yanıt JSON olarak okunamadı: ' + rawText.substring(0, 100));
                }

                if (!result.success) {
                    throw new Error(result.error || 'Bilinmeyen hata');
                }

                if (!Array.isArray(result.movies)) {
                    throw new Error('Drive\'dan beklenmeyen veri formatı geldi');
                }

                // GÜVENLİK KONTROLÜ: Drive'dan boş liste geldi ama yerelde film varsa,
                // bu büyük olasılıkla bir hata/aksaklık belirtisidir. Yerel veriyi SİLMİYORUZ,
                // sadece kullanıcıyı uyarıyoruz. Veri kaybını önlemek bundan daha önemli.
                if (result.movies.length === 0 && movies.length > 0) {
                    console.warn('Drive boş liste döndürdü ama yerelde ' + movies.length + ' film var. Güvenlik amacıyla yerel veri korunuyor.');
                    syncIndicator.classList.remove('syncing');
                    syncIndicator.classList.add('error');
                    syncText.textContent = 'Uyarı: Drive boş görünüyor, yerel veriniz korundu';
                    showToast('⚠️ Drive boş döndü, mevcut filmleriniz korundu. Lütfen Sheet\'i kontrol edin.');
                    return;
                }

                // Drive'dan gelen veri ile yerel listeyi güncelle
                movies = result.movies;
                saveMovies();
                renderMovies();
                updateStats();

                // Dizi verisini de işle (aynı güvenlik mantığıyla)
                if (Array.isArray(result.seriesData)) {
                    if (result.seriesData.length === 0 && series.length > 0) {
                        console.warn('Drive boş dizi listesi döndürdü ama yerelde ' + series.length + ' dizi var. Yerel veri korunuyor.');
                    } else {
                        series = result.seriesData;
                        saveSeries();
                        renderSeriesStats();
                    }
                }

                syncIndicator.classList.remove('syncing', 'error');
                syncText.textContent = 'Senkronizasyon aktif';
            } catch (error) {
                console.error('Drive\'dan yükleme hatası:', error);
                syncIndicator.classList.remove('syncing');
                syncIndicator.classList.add('error');
                syncText.textContent = 'Yükleme hatası: ' + error.message;
                // Hata durumunda da yerel veriye DOKUNMUYORUZ - güvenlik önceliği
            }
        }

        // Google script yüklenince giriş butonunu hazırla
        window.addEventListener('DOMContentLoaded', () => {
            const checkGoogle = setInterval(() => {
                if (window.google && window.google.accounts) {
                    clearInterval(checkGoogle);
                    initGoogleSignIn();
                }
            }, 100);
        });

        // GÜVENLİK: Sayfa arka plandan öne geldiğinde (kullanıcı sekmeye/uygulamaya geri döndüğünde),
        // otomatik olarak Drive'dan taze veri çek. Bu, uzun süre arka planda açık kalmış bir
        // sekmenin/cihazın bayat veriyle senkronizasyon yaparak güncel veriyi ezmesini önler.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && googleIdToken) {
                // ÖNEMLİ: Eğer bekleyen senkronize olmamış dizi değişikliği varsa, Drive'dan
                // taze veri ÇEKMİYORUZ - bu, henüz gönderilmemiş yerel değişikliklerin
                // eski Drive verisiyle ezilmesini önler.
                if (!seriesHasUnsyncedChanges) {
                    console.log('Sayfa öne geldi, Drive\'dan taze veri çekiliyor...');
                    loadMoviesFromDrive();
                }
            }
        });

        // Dizi istatistiklerini güncelleme (Toplam / İzlenmekte / Tamamlanan)
        function renderSeriesStats() {
            const total = series.length;
            let inProgress = 0;
            let completed = 0;

            series.forEach(s => {
                const totalEp = s.seasons.reduce((sum, season) => sum + season.episodes.length, 0);
                const watchedEp = s.seasons.reduce((sum, season) => sum + season.episodes.filter(ep => ep.watched).length, 0);

                if (totalEp > 0 && watchedEp === totalEp) {
                    completed++;
                } else if (watchedEp > 0) {
                    inProgress++;
                }
            });

            document.getElementById('totalSeries').textContent = total;
            document.getElementById('inProgressSeries').textContent = inProgress;
            document.getElementById('completedSeries').textContent = completed;
        }

        // Dizi Listesi Paneli
        let currentSeriesFilter = 'all';

        function showSeriesListPanel(filterValue, title) {
            currentSeriesFilter = filterValue;
            movieListPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            recommendPanel.style.display = 'none';
            seriesListPanel.style.display = 'block';
            seriesPanelTitle.textContent = title;
            renderSeriesList();
            seriesListPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            pushUiState(closeSeriesListPanel);
        }

        function closeSeriesListPanel(fromHistory) {
            seriesListPanel.style.display = 'none';
            if (!fromHistory) popUiStateIfMatch(closeSeriesListPanel);
        }

        function getSeriesProgress(s) {
            const totalEp = s.seasons.reduce((sum, season) => sum + season.episodes.length, 0);
            const watchedEp = s.seasons.reduce((sum, season) => sum + season.episodes.filter(ep => ep.watched).length, 0);
            return { totalEp, watchedEp };
        }

        function getCurrentSeasonEpisode(s) {
            // Henüz tamamlanmamış ilk sezon/bölümü bulur ("nerede kaldım" göstergesi)
            for (const season of s.seasons) {
                const unwatchedEp = season.episodes.find(ep => !ep.watched);
                if (unwatchedEp) {
                    return { season: season.seasonNumber, episode: unwatchedEp.episodeNumber };
                }
            }
            return null; // Tüm bölümler izlenmiş
        }

        function renderSeriesList() {
            const filtered = series.filter(s => {
                const { totalEp, watchedEp } = getSeriesProgress(s);
                if (currentSeriesFilter === 'completed') return totalEp > 0 && watchedEp === totalEp;
                if (currentSeriesFilter === 'inprogress') return watchedEp > 0 && watchedEp < totalEp;
                return true; // 'all'
            });

            if (filtered.length === 0) {
                seriesGrid.innerHTML = '';
                seriesEmptyState.style.display = 'block';
                return;
            }

            seriesEmptyState.style.display = 'none';

            seriesGrid.innerHTML = filtered.map(s => {
                const { totalEp, watchedEp } = getSeriesProgress(s);
                const current = getCurrentSeasonEpisode(s);
                const progressText = current
                    ? `S${current.season} B${current.episode}`
                    : (totalEp > 0 ? '✓ Tamamlandı' : 'Bölüm yok');
                const percentage = totalEp > 0 ? Math.round((watchedEp / totalEp) * 100) : 0;

                return `
                    <div class="movie-card" onclick="openSeriesDetailModal(${s.id})">
                        <div class="movie-poster">
                            ${s.posterUrl ? `<img src="${s.posterUrl}" alt="${s.name}">` : '<span style="font-size: 2em;">📺</span>'}
                        </div>
                        <div class="movie-info">
                            <div class="movie-title">${s.nameTR || s.name}</div>
                            <div class="movie-meta">
                                <span>${s.year}</span>
                                ${s.rating ? `<span>⭐ ${s.rating}</span>` : ''}
                            </div>
                            <div class="movie-genre" style="background: #2a1a3a; color: #9b7ff0; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                                <span>${progressText}</span>
                                <span style="flex-shrink: 0; font-size: 0.9em;">%${percentage}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            renderSeriesPosterGallery(filtered);
        }

        // ============ DİZİ GALERİ (POSTER) GÖRÜNÜMÜ ============
        let seriesGalleryViewActive = false;
        const seriesPosterGallery = document.getElementById('seriesPosterGallery');
        const seriesGalleryToggleBtn = document.getElementById('seriesGalleryToggleBtn');

        seriesGalleryToggleBtn.addEventListener('click', () => {
            seriesGalleryViewActive = !seriesGalleryViewActive;
            seriesGrid.style.display = seriesGalleryViewActive ? 'none' : '';
            seriesPosterGallery.style.display = seriesGalleryViewActive ? 'grid' : 'none';
            seriesGalleryToggleBtn.style.background = seriesGalleryViewActive ? '#9b7ff0' : '#2a2a2a';
            seriesGalleryToggleBtn.style.color = seriesGalleryViewActive ? '#1a1a1a' : '#e0e0e0';
        });

        function renderSeriesPosterGallery(filteredSeries) {
            if (filteredSeries.length === 0) {
                seriesPosterGallery.innerHTML = '';
                return;
            }

            seriesPosterGallery.innerHTML = filteredSeries.map(s => {
                const { totalEp, watchedEp } = getSeriesProgress(s);
                const percentage = totalEp > 0 ? Math.round((watchedEp / totalEp) * 100) : 0;
                const isCompleted = totalEp > 0 && watchedEp === totalEp;

                return `
                <div onclick="openSeriesDetailModal(${s.id})" style="cursor: pointer; position: relative; aspect-ratio: 2/3; border-radius: 8px; overflow: hidden; background: #2a2a2a; border: 2px solid ${isCompleted ? '#9b7ff0' : 'transparent'};">
                    ${s.posterUrl
                        ? `<img src="${s.posterUrl}" alt="${s.name}" style="width: 100%; height: 100%; object-fit: cover;">`
                        : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size: 2em;">📺</div>`
                    }
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.75); padding: 4px 6px;">
                        <div style="background: #1a1a1a; border-radius: 4px; height: 4px; overflow: hidden;">
                            <div style="background: linear-gradient(135deg, #9b7ff0, #6a4fd4); height: 100%; width: ${percentage}%;"></div>
                        </div>
                    </div>
                    ${isCompleted ? `<div style="position: absolute; top: 4px; right: 4px; background: #9b7ff0; color: #1a1a1a; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: bold;">✓</div>` : ''}
                </div>
            `;
            }).join('');
        }

        function deleteSeries(id) {
            if (confirm('Bu diziyi silmek istediğinize emin misiniz?')) {
                series = series.filter(s => s.id !== id);
                saveSeries();
                renderSeriesStats();
                closeSeriesDetailModal();
                renderSeriesList();
                syncSeriesToDrive();
                showToast('Dizi silindi');
            }
        }

        function saveSeriesNameTR(id) {
            const s = series.find(x => x.id === id);
            if (!s) return;

            const input = document.getElementById('seriesDetailNameTR');
            const value = input.value.trim();

            s.nameTR = value || s.name;
            saveSeries();

            if (seriesListPanel.style.display !== 'none') {
                renderSeriesList();
            }

            renderSeriesDetailModal(s); // Sadece içeriği yenile, modal zaten açık kalır
            seriesHasUnsyncedChanges = true; // Dizi senkronizasyon mantığıyla aynı kapanışta-gönder kuralına uysun
            syncText.textContent = 'Değişiklik var (kapatınca kaydedilecek)';
            showToast('Türkçe ad kaydedildi! 🇹🇷');
        }

        // Dizi Detay Modalı - Sezon/Bölüm Takibi
        function openSeriesDetailModal(id) {
            const s = series.find(x => x.id === id);
            if (!s) return;
            renderSeriesDetailModal(s);
            seriesDetailModal.classList.add('active');
            pushUiState(closeSeriesDetailModal);
        }

        // Kullanıcı bir sezonu manuel açıp/kapattığında bu tercihi hatırlar,
        // böylece bölüm işaretlemesi sonrası modal yeniden çizilince sezon kapanmaz.
        function handleSeasonToggle(seriesId, seasonNumber, isOpen) {
            if (!openSeasonsBySeriesId[seriesId]) openSeasonsBySeriesId[seriesId] = new Set();
            if (isOpen) {
                openSeasonsBySeriesId[seriesId].add(seasonNumber);
            } else {
                openSeasonsBySeriesId[seriesId].delete(seasonNumber);
            }
        }

        function closeSeriesDetailModal(fromHistory) {
            seriesDetailModal.classList.remove('active');
            if (!fromHistory) popUiStateIfMatch(closeSeriesDetailModal);

            // Modal kapanırken, bölüm işaretlemelerinden bekleyen değişiklik varsa
            // TEK BİR senkronizasyon isteği gönder (art arda tıklamalarda Drive'a
            // tekrar tekrar yazmak yerine, en güncel durumu bir kerede gönderir).
            if (seriesHasUnsyncedChanges) {
                seriesHasUnsyncedChanges = false;
                syncSeriesToDrive();
            }
        }

        // Dizi detayından "Ekle" butonuna basılınca: modalı KAPATMIYORUZ, sadece gizliyoruz
        // (içeriği DOM'da saklı kalır). Film Ekle modalı kapatıldığında otomatik geri gösterilir.
        function closeSeriesDetailModalThenAdd(imdbID) {
            seriesDetailModal.classList.remove('active');
            removeFromUiStackSilently(closeSeriesDetailModal);
            hiddenSeriesDetailModalPending = true;
            openModal();
            selectMovie(imdbID);
        }

        // Dizi detay modalında hangi sezonun açık olduğunu hatırlar (id -> seasonNumber seti)
        // Bu sayede bir bölüm işaretlendiğinde modal yeniden çizilse de sezon kapanmaz.
        let openSeasonsBySeriesId = {};

        function renderSeriesDetailModal(s) {
            const { totalEp, watchedEp } = getSeriesProgress(s);
            const percentage = totalEp > 0 ? Math.round((watchedEp / totalEp) * 100) : 0;

            if (!openSeasonsBySeriesId[s.id]) openSeasonsBySeriesId[s.id] = new Set();
            const openSeasons = openSeasonsBySeriesId[s.id];

            const seasonsHtml = s.seasons.map(season => {
                const seasonWatched = season.episodes.filter(ep => ep.watched).length;
                const episodesHtml = season.episodes.map(ep => `
                    <div class="episode-row" onclick="toggleEpisodeWatched(${s.id}, ${season.seasonNumber}, ${ep.episodeNumber})" style="display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; cursor: pointer; background: ${ep.watched ? '#9b7ff015' : 'transparent'}; transition: opacity 0.2s;">
                        <span style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid ${ep.watched ? '#9b7ff0' : '#555'}; background: ${ep.watched ? '#9b7ff0' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 0.8em; color: #1a1a1a; font-weight: bold;">
                            ${ep.watched ? '✓' : ''}
                        </span>
                        <span style="flex: 1; font-size: 0.85em; color: ${ep.watched ? '#ccc' : '#999'};">
                            <strong>${ep.episodeNumber}.</strong> ${ep.title || 'Bölüm ' + ep.episodeNumber}
                        </span>
                    </div>
                `).join('');

                const isOpen = openSeasons.has(season.seasonNumber);

                return `
                    <details ${isOpen ? 'open' : ''} ontoggle="handleSeasonToggle(${s.id}, ${season.seasonNumber}, this.open)" style="margin-bottom: 10px; background: #1a1a1a; border-radius: 8px; padding: 10px;">
                        <summary style="cursor: pointer; color: #9b7ff0; font-weight: 600; padding: 4px;">
                            Sezon ${season.seasonNumber} (${seasonWatched}/${season.episodes.length})
                        </summary>
                        <div style="margin-top: 8px;">${episodesHtml}</div>
                    </details>
                `;
            }).join('');

            seriesDetailModalContent.innerHTML = `
                <div style="text-align: center; margin-bottom: 15px;">
                    <div style="width: 100%; max-height: 280px; border-radius: 8px; overflow: hidden; background: #1a1a1a; display: flex; align-items: center; justify-content: center;">
                        ${s.posterUrl ? `<img src="${s.posterUrl}" alt="${s.name}" style="width: 100%; object-fit: contain; max-height: 280px;">` : '<span style="font-size: 4em; padding: 60px 0;">📺</span>'}
                    </div>
                </div>
                <h2 style="color: #9b7ff0; margin-bottom: 5px;">${s.nameTR || s.name}</h2>
                ${s.nameTR && s.nameTR !== s.name ? `<p style="color: #999; font-size: 0.9em; margin-bottom: 15px;">Orijinal Adı: ${s.name}</p>` : '<div style="margin-bottom: 15px;"></div>'}

                <div style="margin-bottom: 15px;">
                    <div style="color: #9b7ff0; font-weight: 600; margin-bottom: 6px;">🇹🇷 Türkçe Adı</div>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="seriesDetailNameTR" value="${s.nameTR || s.name}" placeholder="Türkçe adını yazın" style="flex: 1; padding: 8px 10px; background: #1a1a1a; border: 2px solid #404040; color: #e0e0e0; border-radius: 6px;">
                        <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 16px; background: #9b7ff0;" onclick="saveSeriesNameTR(${s.id})">Kaydet</button>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                    <span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">📅 ${s.year}</span>
                    ${s.runtime ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">⏱️ ${s.runtime}</span>` : ''}
                    ${s.rated ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">🔞 ${s.rated}</span>` : ''}
                    ${s.rating ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">⭐ ${s.rating}</span>` : ''}
                    ${s.rottenTomatoes ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">🍅 ${s.rottenTomatoes}</span>` : ''}
                    ${s.metacritic ? `<span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">Ⓜ️ ${s.metacritic}</span>` : ''}
                    <span style="background: #1a1a1a; padding: 5px 12px; border-radius: 6px; font-size: 0.9em;">📦 ${s.totalSeasons} Sezon</span>
                </div>

                <div style="margin-bottom: 15px; padding: 12px; background: #1a1a1a; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.9em;">
                        <span style="color: #e0e0e0;">İlerleme</span>
                        <span style="color: #9b7ff0;">${watchedEp}/${totalEp} bölüm (%${percentage})</span>
                    </div>
                    <div style="background: #2a2a2a; border-radius: 6px; height: 10px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #9b7ff0, #6a4fd4); height: 100%; width: ${percentage}%;"></div>
                    </div>
                </div>

                <div style="margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #9b7ff0; font-weight: 600;">Tür: </span>
                    <span style="color: #ccc;">${s.genre}</span>
                </div>

                ${s.director ? `
                <div style="margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #9b7ff0; font-weight: 600;">Yaratıcı/Yönetmen: </span>
                    <span style="color: #ccc;">${s.director}</span>
                    <button class="modal-btn secondary" style="padding: 4px 10px; font-size: 0.75em; margin-left: 8px;" onclick="showSeriesCreatorOtherWorks('${s.director.split(',')[0].trim().replace(/'/g, "\\'")}')">📺 Diğer Dizileri</button>
                </div>` : ''}

                ${s.writer ? `
                <div style="margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #9b7ff0; font-weight: 600;">Senarist: </span>
                    <span style="color: #ccc;">${s.writer}</span>
                </div>` : ''}

                ${s.actors ? `
                <div style="margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #9b7ff0; font-weight: 600;">🎭 Oyuncular: </span>
                    <span style="color: #ccc;">${s.actors}</span>
                </div>` : ''}

                <div id="seriesCreatorOtherWorksResult"></div>

                <div style="margin-bottom: 15px;">
                    <div style="color: #9b7ff0; font-weight: 600; margin-bottom: 4px;">Konusu</div>
                    <div style="color: #ccc; line-height: 1.5; font-size: 0.9em;">${s.plot}</div>
                </div>

                ${s.awards ? `
                <div style="margin-bottom: 12px; font-size: 0.9em;">
                    <span style="color: #9b7ff0; font-weight: 600;">🏆 Ödüller: </span>
                    <span style="color: #ccc;">${s.awards}</span>
                </div>` : ''}

                <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.8em; color: #888; margin-bottom: 15px;">
                    ${s.country ? `<span>🌍 ${s.country}</span>` : ''}
                    ${s.language ? `<span>🗣️ ${s.language}</span>` : ''}
                    ${s.released ? `<span>🎬 İlk Yayın: ${s.released}</span>` : ''}
                    ${s.boxoffice ? `<span>💰 ${s.boxoffice}</span>` : ''}
                </div>

                <h4 style="color: #e0e0e0; margin-bottom: 10px;">Sezonlar ve Bölümler</h4>
                ${seasonsHtml}

                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button class="modal-btn secondary" style="flex: 1; background: #5a3a3a; color: #ff8a9a;" onclick="deleteSeries(${s.id})">🗑️ Sil</button>
                    <button class="modal-btn secondary" style="flex: 1;" onclick="closeSeriesDetailModal()">Kapat</button>
                </div>
            `;
        }

        // Dizinin yaratıcısının/yönetmeninin diğer dizilerini Gemini'den önerme
        async function showSeriesCreatorOtherWorks(creatorName) {
            const container = document.getElementById('seriesCreatorOtherWorksResult');
            if (!container) return;

            container.innerHTML = `
                <div style="text-align: center; padding: 15px;">
                    <div class="loading-spinner"></div>
                    <p style="color: #999; font-size: 0.8em; margin-top: 8px;">Gemini'den öneriler isteniyor...</p>
                </div>
            `;

            try {
                const titles = await askGeminiForMovieTitles(
                    `${creatorName} adlı kişinin yaratıcısı/yönetmeni olduğu en bilinen 6 TV dizisi nedir?`,
                    6
                );

                if (!titles || titles.length === 0) {
                    container.innerHTML = `<p style="color: #999; font-size: 0.85em; margin-bottom: 15px;">Öneri alınamadı, lütfen tekrar deneyin.</p><p style="color:#ff5576; font-size:0.75em; word-break: break-all;">Debug: ${lastGeminiDebugInfo}</p>`;
                    return;
                }

                const existingTitles = new Set(series.map(x => x.name.toLowerCase()));
                const results = [];

                for (const title of titles) {
                    try {
                        const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&type=series&apikey=${OMDB_API}`);
                        const show = await response.json();
                        if (show.Response !== 'False' && !existingTitles.has(show.Title.toLowerCase())) {
                            results.push(show);
                        }
                    } catch (e) {
                        // tek bir başlık başarısız olursa diğerlerine devam et
                    }
                }

                if (results.length === 0) {
                    container.innerHTML = `<p style="color: #999; font-size: 0.85em; margin-bottom: 15px;">Zaten kütüphanenizde olabilirler veya bulunamadı.</p>`;
                    return;
                }

                container.innerHTML = `
                    <div style="margin-top: 10px; margin-bottom: 15px;">
                        <div style="color: #999; font-size: 0.8em; margin-bottom: 8px;">✨ Gemini'nin önerdiği "${creatorName}" dizileri:</div>
                        ${results.map(sw => `
                            <div style="display: flex; gap: 10px; align-items: center; background: #1a1a1a; border-radius: 6px; padding: 8px; margin-bottom: 6px;">
                                <div style="width: 36px; height: 52px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                                    ${sw.Poster !== 'N/A' ? `<img src="${sw.Poster}" style="width: 100%; height: 100%; object-fit: cover;">` : '<span style="font-size: 1em;">📺</span>'}
                                </div>
                                <span style="flex: 1; font-size: 0.9em; color: #ccc;">${sw.Title} (${sw.Year}) ${sw.imdbRating !== 'N/A' ? '⭐' + sw.imdbRating : ''}</span>
                                <button class="modal-btn primary" style="flex: 0 0 auto; padding: 4px 10px; font-size: 0.8em; background: #9b7ff0;" onclick="closeSeriesDetailModalThenAdd('${sw.imdbID}')">Ekle</button>
                            </div>
                        `).join('')}
                    </div>
                `;
            } catch (error) {
                console.error('Dizi yaratıcısı arama hatası:', error);
                container.innerHTML = `<p style="color: #ff5576; font-size: 0.85em;">Arama sırasında hata oluştu.</p>`;
            }
        }

        // Bölüm tıklamalarını hızlı art arda yapmaya karşı koruma
        let episodeClickLocked = false;
        let seriesSyncDebounceTimer = null;

        // Dizi detay modalı açıkken yapılan bölüm işaretlemeleri, modal KAPANANA KADAR
        // sadece yerelde tutulur, Drive'a anında gönderilmez. Modal kapatıldığında
        // (Kapat butonu veya geri tuşu ile) eğer değişiklik varsa TEK BİR senkronizasyon yapılır.
        // Bu, art arda hızlı bölüm işaretlemede oluşan çakışan/tekrarlı Drive isteklerini önler.
        let seriesHasUnsyncedChanges = false;

        function toggleEpisodeWatched(seriesId, seasonNumber, episodeNumber) {
            // KORUMA: Tıklama kilidi - 1 saniye içinde tekrar tıklamayı engeller
            if (episodeClickLocked) return;
            episodeClickLocked = true;

            // Görsel geri bildirim: kilit süresince tüm bölüm satırlarını soluklaştır
            document.querySelectorAll('.episode-row').forEach(row => {
                row.style.opacity = '0.5';
                row.style.pointerEvents = 'none';
            });

            setTimeout(() => {
                episodeClickLocked = false;
                document.querySelectorAll('.episode-row').forEach(row => {
                    row.style.opacity = '1';
                    row.style.pointerEvents = 'auto';
                });
            }, 1000);

            const s = series.find(x => x.id === seriesId);
            if (!s) return;

            const season = s.seasons.find(se => se.seasonNumber === seasonNumber);
            if (!season) return;

            const episode = season.episodes.find(ep => ep.episodeNumber === episodeNumber);
            if (!episode) return;

            episode.watched = !episode.watched;
            saveSeries(); // Yerel (localStorage) kayıt - anında, kayıp riski yok
            renderSeriesStats();
            renderSeriesDetailModal(s); // Modalı yeniden çiz, güncel ilerlemeyi göster

            // Dizi listesi paneli açıksa (kartlardaki ilerleme çubuğu), onu da güncelle
            if (seriesListPanel.style.display !== 'none') {
                renderSeriesList();
            }

            // Drive'a HENÜZ göndermiyoruz - sadece "değişiklik var" işaretliyoruz.
            // Gerçek senkronizasyon, modal kapatıldığında bir kerede yapılacak.
            seriesHasUnsyncedChanges = true;
            syncText.textContent = 'Değişiklik var (kapatınca kaydedilecek)';
        }

        // Google Drive'a Dizi Senkronizasyonu
        async function syncSeriesToDrive() {
            if (!appsScriptUrl || !googleIdToken) return;

            syncIndicator.classList.add('syncing');
            syncText.textContent = 'Senkronize ediliyor...';

            try {
                const response = await fetch(appsScriptUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        idToken: googleIdToken,
                        seriesData: series // Apps Script tarafında ayrı bir sheet'e yazılacak
                    })
                });

                const rawText = await response.text();
                let result;
                try {
                    result = JSON.parse(rawText);
                } catch (e) {
                    throw new Error('Yanıt okunamadı');
                }

                if (!result.success) {
                    throw new Error(result.error || 'Bilinmeyen hata');
                }

                syncIndicator.classList.remove('syncing', 'error');
                syncText.textContent = 'Senkronizasyon aktif';
            } catch (error) {
                console.error('Dizi senkronizasyon hatası:', error);
                syncIndicator.classList.remove('syncing');
                syncIndicator.classList.add('error');
                syncText.textContent = 'Hata: ' + error.message;
            }
        }

        // ============ DİZİ SİSTEMİ SONU ============
        // Service Worker kaydı (PWA - "Ana ekrana ekle" desteği için)
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').catch(err => {
                    console.log('Service worker kaydı başarısız:', err);
                });
            });
        }
