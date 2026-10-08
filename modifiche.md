Modifiche da effettuare:

## 1. Dashboard / Home Page

### Nuove Funzionalità

* **Mini-Classifiche (Leaderboard):**
* Poiché il sistema calcola già automaticamente voti, gol e assist dalla card *"Report Partita"*, inserisci direttamente in Home una sezione con la **Top 3** (filtrabile per mese o per stagione intera).
* Prevedi un carosello o un selettore per alternare le seguenti metriche:
* **Capocannoniere** (maggior numero di gol)
* **Miglior Assistman** (maggior numero di assist)
* **Voto Medio Più Alto**





---

## 2. Gestione Giocatori (UI/UX)

### Problemi di Usabilità e Proposte di Miglioramento

* **Ricerca e Navigazione:** L'attuale processo di ricerca e aggiunta/modifica dei giocatori è troppo macchinoso.
* **Ottimizzazione Attributi:** Nascondi i dettagli analitici degli attributi (Velocità, Tiro, Passaggio, ecc.) all'apertura del profilo e rendili visibili solo su richiesta tramite un bottone dedicato (es. *"Mostra Dettagli Attributi"*).
* **Gestione Eliminazione:** Sposta il bottone di eliminazione del giocatore all'interno della schermata di **Modifica**, così da evitare cancellazioni accidentali e pulire la vista principale.
* **Sezione Import/Export CSV:** Riduci l'impatto visivo e l'invasività dell'area dedicata all'importazione/esportazione via CSV.

---

## 3. Gestione Intesa

### Problema di Design Grafico

* La logica e la velocità d'impostazione dell'intesa sono ottime, ma la componente visiva per la selezione dei giocatori coinvolti necessita di un restyling grafico completo.

### Risoluzione del Conflitto di Assegnazione (Asimmetria)

**Il Problema:** Se l'Utente A (Ontor) imposta un'intesa valore `5` verso l'Utente B (Cyran), e l'Utente B (Cyran) imposta un'intesa valore `3` verso l'Utente A (Ontor), il sistema attualmente sovrascrive il dato mostrando per entrambi `3`.

**Soluzione Proposta per Risolvere la Sovrascrittura:**

Rendere l'intesa asimmetrica, quindi ogni giocatore può esprimere un livello di intesa propria con altri giocatori.
es. Ontor imposta 5 come intesa per Cyran, Cyran imposta 3 come intesa con Ontor. Quando viene visualizzata la lista delle intese per Ontor, Cyran avrà 5, mentre nella lista di Cyran, Ontor avrà 3.

Solamente per l'algoritmo del matchmaking, verrà considerata la media matematica: $\frac{5 + 3}{2} = 4$.



---

## 4. Matchmaker & Formazioni

### Movimento Liberamente Trascinabile (Drag & Drop)

* Permetti lo spostamento libero dei giocatori in qualsiasi posizione sul campo (sinistra, destra, centro) quando si genera la formazione. (possibilmente anche tra squadre, scambiando i giocatori)

### Esportazione Formazione in Formato Immagine

* Aggiungi un pulsante *"Scarica / Condividi Immagine"* per generare al volo un layout grafico della formazione da inviare facilmente sui gruppi chat (es. WhatsApp/Telegram).

### Restyling Griglia di Selezione Giocatori

* **Formato Attuale:** Elenco verticale a lista unica (una riga per giocatore), poco efficiente in termini di spazio.
* **Nuovo Formato a Griglia (Card compaiono 5-6 per riga):**
* Layout a card disposte in 5 o 6 colonne per riga.
* Testo più grande per evidenziare **Nome** e **Overall (OVR)** nella parte superiore della scheda.
* Indicatore della **Forma** posizionato nella parte inferiore della card.



**Struttura della singola card:**

```text
+-----------------------+
|  NOME          OVR    |  <-- Font grande e ben visibile
|  Forma                |  <-- Dettaglio forma in basso
+-----------------------+

```