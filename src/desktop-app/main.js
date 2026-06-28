/* eslint-disable no-undef */
const { app, BrowserWindow } = require('electron');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true, // Ocultar barra superior
    webPreferences: {
      devTools: false, // Desactiva F12 e inspeccionar elementos
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Evita que la app se duerma en segundo plano y corte los sonidos
    }
  });

  // 1. Modificar el User-Agent para inyectar nuestra clave de seguridad
  const customUserAgent = mainWindow.webContents.getUserAgent() + ' RemisesConcepcion-AdminApp';
  mainWindow.webContents.setUserAgent(customUserAgent);

  // 2. Cargar la URL de producción (Asegúrate de cambiar esto por la URL publicada real de tu app)
  const targetUrl = 'https://TU-URL-DE-PRODUCCION.com'; 
  mainWindow.loadURL(targetUrl);

  // 3. Sistema de recarga automática en caso de pérdida de conexión
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    // Si el error se debe a falta de red o DNS (ERR_INTERNET_DISCONNECTED / ERR_NAME_NOT_RESOLVED)
    if (errorCode === -105 || errorCode === -106) {
      console.log('Pérdida de conexión detectada. Reintentando reconexión automática en 5 segundos...');
      setTimeout(() => {
        mainWindow.loadURL(targetUrl);
      }, 5000);
    }
  });
}

// Permitir que los sonidos se reproduzcan automáticamente sin requerir que el usuario haga clic
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});