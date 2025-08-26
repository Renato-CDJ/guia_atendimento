// Importações do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAuth, signInAnonymously, updateProfile } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Configuração
const firebaseConfig = {
  apiKey: "AIzaSyDM-cWulKkn5RAT6tns0BktHkRdfFt4-0s",
  authDomain: "roteiro-a6cb0.firebaseapp.com",
  projectId: "roteiro-a6cb0",
  storageBucket: "roteiro-a6cb0.appspot.com",
  messagingSenderId: "304848084937",
  appId: "1:304848084937:web:21c4d4ea2dc862e7e05218",
  measurementId: "G-PLMNPQWVH9"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Expondo
const db = getFirestore(app);
const auth = getAuth(app);

export { app, analytics, db, auth, signInAnonymously, updateProfile };
