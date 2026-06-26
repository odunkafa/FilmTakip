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
        let currentFilter = 'all';
        let searchQuery = '';
        let appsScriptUrl = 'https://script.google.com/macros/s/AKfycbzl2Xw5QEVQkd9kM5nvU8ovWwH1WHuMxRkvkn1b2oqGzg3MLW4ciQARD7DLZ10ZhrMbvw/exec';

        const OMDB_API = 'c3201f93';
        const GEMINI_API_KEY = 'AIzaSyDjvVmA4Y0pj0eYyp-5ly4zr7zPG2KEaug';

        // Gemini API'ye basit bir metin sorusu gönderip yanıtı döndürür
        async function askGemini(prompt) {
            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-goog-api-key': GEMINI_API_KEY
                        },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }]
                        })
                    }
                );

                const data = await response.json();

                if (data.error) {
                    console.error('Gemini API hatası:', data.error);
                    return null;
                }

                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                return text || null;
            } catch (error) {
                console.error('Gemini çağrı hatası:', error);
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

        // Öneri sistemi için sabit popüler film havuzu (tür bazlı, IMDb ID ile)
        // OMDb türe göre listeleme sunmadığı için bu havuzdan filtreleme yapıyoruz
        const POPULAR_MOVIES_POOL = [
            { id: 'tt1375666', genre: 'Bilim Kurgu' },        // Inception
            { id: 'tt0816692', genre: 'Bilim Kurgu' },        // Interstellar
            { id: 'tt0133093', genre: 'Bilim Kurgu' },        // The Matrix
            { id: 'tt0468569', genre: 'Aksiyon' },            // The Dark Knight
            { id: 'tt1345836', genre: 'Aksiyon' },            // The Dark Knight Rises
            { id: 'tt0848228', genre: 'Aksiyon' },            // The Avengers
            { id: 'tt4154796', genre: 'Aksiyon' },            // Avengers: Endgame
            { id: 'tt0109830', genre: 'Drama' },              // Forrest Gump
            { id: 'tt0111161', genre: 'Drama' },              // Shawshank Redemption
            { id: 'tt0068646', genre: 'Drama' },               // The Godfather
            { id: 'tt0137523', genre: 'Drama' },               // Fight Club
            { id: 'tt0110912', genre: 'Suç' },                 // Pulp Fiction
            { id: 'tt0114369', genre: 'Suç' },                 // Se7en
            { id: 'tt0167260', genre: 'Fantastik' },          // LOTR: Return of the King
            { id: 'tt0120737', genre: 'Fantastik' },          // LOTR: Fellowship
            { id: 'tt0241527', genre: 'Fantastik' },          // Harry Potter 1
            { id: 'tt0317248', genre: 'Drama' },               // City of God
            { id: 'tt0099685', genre: 'Suç' },                 // Goodfellas
            { id: 'tt0102926', genre: 'Suç' },                 // Silence of the Lambs
            { id: 'tt0118799', genre: 'Drama' },               // Life is Beautiful
            { id: 'tt0076759', genre: 'Bilim Kurgu' },        // Star Wars
            { id: 'tt0080684', genre: 'Bilim Kurgu' },        // Empire Strikes Back
            { id: 'tt0player', genre: '' },                    // (yanlış id - güvenlik amaçlı yer tutucu, filtrelenir)
            { id: 'tt0993846', genre: 'Komedi' },              // Wolf of Wall Street
            { id: 'tt2582802', genre: 'Drama' },               // Whiplash
            { id: 'tt0407887', genre: 'Suç' },                 // The Departed
            { id: 'tt0482571', genre: 'Gizem' },               // The Prestige
            { id: 'tt1853728', genre: 'Western' },             // Django Unchained
            { id: 'tt0086190', genre: 'Bilim Kurgu' },        // Return of the Jedi
            { id: 'tt0078748', genre: 'Korku' },               // Alien
            { id: 'tt0103064', genre: 'Aksiyon' },             // Terminator 2
            { id: 'tt0364569', genre: 'Korku' },               // Oldboy
            { id: 'tt0114814', genre: 'Suç' },                 // The Usual Suspects
            { id: 'tt6751668', genre: 'Drama' },               // Parasite
            { id: 'tt15398776', genre: 'Aksiyon' },            // Oppenheimer
            { id: 'tt1160419', genre: 'Bilim Kurgu' },        // Dune
            { id: 'tt9362722', genre: 'Bilim Kurgu' },        // Dune: Part Two
            { id: 'tt10872600', genre: 'Aksiyon' },            // Spider-Man: No Way Home
            { id: 'tt1727824', genre: 'Korku' },               // Bone Tomahawk
            { id: 'tt0114709', genre: 'Animasyon' },          // Toy Story
            { id: 'tt2380307', genre: 'Animasyon' },          // Coco
        ].filter(m => m.genre); // yer tutucuları temizle

        // DOM Elementleri
        const addMovieBtn = document.querySelector('.add-movie-btn');
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
            movieListPanel.style.display = 'block';
            panelTitle.textContent = title;
            renderMovies();
            movieListPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        document.getElementById('statTotal').addEventListener('click', () => showMovieListPanel('all', '🎬 Tüm Filmler'));
        document.getElementById('statWatched').addEventListener('click', () => showMovieListPanel('watched', '✓ İzlenen Filmler'));
        document.getElementById('statPending').addEventListener('click', () => showMovieListPanel('pending', '⏳ İzlenecek Filmler'));
        document.getElementById('statPercentage').addEventListener('click', () => showWatchStatsPanel());

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
                
                const response = await fetch(
                    `https://www.omdbapi.com/?s=${encodeURIComponent(query)}&type=movie&apikey=${OMDB_API}`
                );
                const data = await response.json();

                if (data.Search) {
                    searchSuggestions.innerHTML = data.Search.slice(0, 8).map(movie => `
                        <div class="suggestion-item" onclick="selectMovie('${movie.imdbID}')">
                            <div style="flex: 1;">
                                <div style="font-weight: 600;">${movie.Title}</div>
                                <div style="font-size: 0.8em; color: #999;">${movie.Year}</div>
                            </div>
                        </div>
                    `).join('');
                    searchSuggestions.classList.add('active');
                } else {
                    searchSuggestions.innerHTML = '<div style="padding: 15px; text-align: center; color: #999;">Film bulunamadı</div>';
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

                const response = await fetch(
                    `https://www.omdbapi.com/?i=${imdbID}&apikey=${OMDB_API}&plot=full`
                );
                const movie = await response.json();

                if (movie.Response !== 'False') {
                    // Film adı İNGİLİZCE kalır (çevrilmez)
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
                    showToast('Film bilgileri yüklendi! ✓');
                }
            } catch (error) {
                console.error('Film yükleme hatası:', error);
                showToast('Film bilgileri yüklenemedi');
            }
        }

        // Film Ekleme
        function handleAddMovie(e) {
            e.preventDefault();
            
            const name = document.getElementById('movieName').value;
            const nameTR = document.getElementById('movieNameTR').value;
            const year = document.getElementById('movieYear').value;
            const genre = document.getElementById('movieGenre').value;
            const plot = document.getElementById('moviePlot').value;
            const director = document.getElementById('movieDirector').value;
            const rating = document.getElementById('movieRating').value;
            const myRating = document.getElementById('myRating').value;

            if (!name.trim()) {
                showToast('Lütfen bir film seçin');
                return;
            }

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

        function closeStatsPanel() {
            statsPanel.style.display = 'none';
            statsPanel.innerHTML = '';
        }

        // ============ ÖNERİ SİSTEMİ (Bana Öner) ============
        const recommendPanel = document.getElementById('recommendPanel');

        async function showRecommendations() {
            movieListPanel.style.display = 'none';
            statsPanel.style.display = 'none';
            recommendPanel.style.display = 'block';

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px; text-align: center;">
                    <div class="loading-spinner" style="margin: 20px auto;"></div>
                    <p style="color: #999;">Gemini önerilerinizi hazırlıyor...</p>
                </div>
            `;
            recommendPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // En çok izlenen tür, yönetmen ve oyuncuyu bul
            const genreCounts = {};
            const directorCounts = {};
            const actorCounts = {};

            movies.forEach(movie => {
                if (!movie.watched) return;

                if (movie.genre) {
                    movie.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
                        genreCounts[g] = (genreCounts[g] || 0) + 1;
                    });
                }
                if (movie.director) {
                    movie.director.split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
                        directorCounts[d] = (directorCounts[d] || 0) + 1;
                    });
                }
                if (movie.actors) {
                    movie.actors.split(',').map(a => a.trim()).filter(Boolean).forEach(a => {
                        actorCounts[a] = (actorCounts[a] || 0) + 1;
                    });
                }
            });

            const sortByCount = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a]);

            const favoriteGenre = sortByCount(genreCounts)[0] || null;
            const favoriteDirector = sortByCount(directorCounts)[0] || null;
            const favoriteActor = sortByCount(actorCounts)[0] || null;

            const existingTitles = new Set(movies.map(m => m.name.toLowerCase()));
            let results = [];
            let usedGeminiInfo = null;

            // Gemini'den kişiselleştirilmiş öneri istemeyi dene
            if (favoriteDirector || favoriteActor || favoriteGenre) {
                let prompt = 'Bana film önerileri yap. ';
                if (favoriteDirector) prompt += `En çok izlediğim yönetmen ${favoriteDirector}. `;
                if (favoriteActor) prompt += `En çok izlediğim oyuncu ${favoriteActor}. `;
                if (favoriteGenre) prompt += `En sevdiğim tür ${favoriteGenre}. `;
                prompt += 'Bu zevkime uygun, benzer tarzda 6 film öner.';

                const titles = await askGeminiForMovieTitles(prompt, 6);

                if (titles && titles.length > 0) {
                    for (const title of titles) {
                        try {
                            const response = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(title)}&apikey=${OMDB_API}`);
                            const movie = await response.json();
                            if (movie.Response !== 'False' && !existingTitles.has(movie.Title.toLowerCase())) {
                                results.push(movie);
                            }
                        } catch (e) { /* devam et */ }
                    }
                    if (results.length > 0) {
                        usedGeminiInfo = { favoriteDirector, favoriteActor, favoriteGenre };
                    }
                }
            }

            // Gemini başarısız olduysa veya sonuç bulunamadıysa, sabit havuza geri dön
            if (results.length === 0) {
                let candidates = POPULAR_MOVIES_POOL;
                if (favoriteGenre) {
                    const matching = POPULAR_MOVIES_POOL.filter(m => m.genre === favoriteGenre);
                    if (matching.length >= 3) candidates = matching;
                }

                const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 5);

                for (const candidate of shuffled) {
                    try {
                        const response = await fetch(`https://www.omdbapi.com/?i=${candidate.id}&apikey=${OMDB_API}`);
                        const movie = await response.json();
                        if (movie.Response !== 'False' && !existingTitles.has(movie.Title.toLowerCase())) {
                            results.push(movie);
                        }
                    } catch (e) {
                        console.error('Öneri yükleme hatası:', e);
                    }
                }
            }

            renderRecommendations(results, favoriteGenre, usedGeminiInfo);
        }

        function renderRecommendations(results, favoriteGenre, geminiInfo) {
            let introText;
            if (geminiInfo) {
                const parts = [];
                if (geminiInfo.favoriteDirector) parts.push(`yönetmen <strong style="color:#d4af37;">${geminiInfo.favoriteDirector}</strong>`);
                if (geminiInfo.favoriteActor) parts.push(`oyuncu <strong style="color:#d4af37;">${geminiInfo.favoriteActor}</strong>`);
                if (geminiInfo.favoriteGenre) parts.push(`<strong style="color:#d4af37;">${geminiInfo.favoriteGenre}</strong> türü`);
                introText = `✨ Gemini, en çok izlediğiniz ${parts.join(', ')} zevkinize göre bu önerileri hazırladı:`;
            } else if (favoriteGenre) {
                introText = `En çok izlediğiniz tür <strong style="color:#d4af37;">${favoriteGenre}</strong> olduğu için, bu türden öneriler hazırladık:`;
            } else {
                introText = `İşte sizin için bazı öneriler:`;
            }

            const cardsHtml = results.length > 0 ? results.map(movie => `
                <div style="background: #1a1a1a; border-radius: 8px; padding: 15px; margin-bottom: 12px; display: flex; gap: 12px; align-items: center;">
                    <div style="width: 60px; height: 85px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #2a2a2a; display: flex; align-items: center; justify-content: center;">
                        ${movie.Poster !== 'N/A' ? `<img src="${movie.Poster}" style="width: 100%; height: 100%; object-fit: cover;">` : '🎬'}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #e0e0e0;">${movie.Title}</div>
                        <div style="font-size: 0.85em; color: #999; margin: 4px 0;">${movie.Year} · ⭐ ${movie.imdbRating !== 'N/A' ? movie.imdbRating : '?'}</div>
                        <div style="font-size: 0.8em; color: #777;">${movie.Genre}</div>
                    </div>
                    <button class="modal-btn primary" style="flex: 0 0 auto; padding: 8px 14px; font-size: 0.85em;" onclick="quickAddFromRecommendation('${movie.imdbID}')">Ekle</button>
                </div>
            `).join('') : '<p style="color: #999; text-align: center;">Şu an öneri bulunamadı, daha fazla film izleyip tekrar deneyin.</p>';

            recommendPanel.innerHTML = `
                <div style="background: #2a2a2a; border-radius: 10px; padding: 25px;">
                    <h3 style="color: #d4af37; margin-bottom: 10px;">🎯 Size Özel Öneriler</h3>
                    <p style="color: #999; margin-bottom: 20px; font-size: 0.9em;">${introText}</p>
                    ${cardsHtml}
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button class="modal-btn secondary" style="flex: 1;" onclick="showRecommendations()">🔄 Yeni Öneriler</button>
                        <button class="modal-btn secondary" style="flex: 1;" onclick="closeRecommendPanel()">Kapat</button>
                    </div>
                </div>
            `;
        }

        async function quickAddFromRecommendation(imdbID) {
            openModal();
            await selectMovie(imdbID);
        }

        function closeRecommendPanel() {
            recommendPanel.style.display = 'none';
            recommendPanel.innerHTML = '';
        }

        // Modal Yönetimi
        function openModal() {
            movieForm.reset();
            modal.classList.add('active');
            document.getElementById('movieSearch').focus();
        }

        function closeModal() {
            modal.classList.remove('active');
            movieForm.reset();
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
        }

        // Film Detay Modalı
        const detailModal = document.getElementById('detailModal');
        const detailModalContent = document.getElementById('detailModalContent');

        function openDetailModal(id) {
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

            detailModal.classList.add('active');
        }

        function closeDetailModal() {
            detailModal.classList.remove('active');
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
                    container.innerHTML = `<p style="color: #999; font-size: 0.85em; margin-bottom: 15px;">Öneri alınamadı, lütfen tekrar deneyin.</p>`;
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
                                <span style="flex: 1; font-size: 0.9em; color: #ccc;">${m.Title} (${m.Year}) ${m.imdbRating !== 'N/A' ? '⭐' + m.imdbRating : ''}</span>
                                <button class="modal-btn primary" style="flex: 0 0 auto; padding: 4px 10px; font-size: 0.8em;" onclick="closeDetailModal(); openModal(); selectMovie('${m.imdbID}');">Ekle</button>
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

        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) closeDetailModal();
        });

        // LocalStorage'a Kaydet
        function saveMovies() {
            localStorage.setItem('filmKutuphanesi', JSON.stringify(movies));
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
            await loadMoviesFromDrive();
        }

        // Drive'daki Google Sheet'ten film verilerini çekip yerel listeyi günceller
        async function loadMoviesFromDrive() {
            if (!appsScriptUrl || !googleIdToken) return;

            syncIndicator.classList.add('syncing');
            syncText.textContent = 'Drive\'dan yükleniyor...';

            try {
                const url = appsScriptUrl + '?idToken=' + encodeURIComponent(googleIdToken);
                const response = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow'
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

        // Service Worker kaydı (PWA - "Ana ekrana ekle" desteği için)
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').catch(err => {
                    console.log('Service worker kaydı başarısız:', err);
                });
            });
        }
