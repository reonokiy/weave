import { createApp } from 'vue'
import 'virtual:uno.css'
import './style.css'
import App from './App.vue'
import ServerApp from './ServerApp.vue'
import { readServerPage } from './lib/server-page'
import { i18n, initializeLocale } from './i18n'

const serverPage = readServerPage()
initializeLocale(Boolean(serverPage))
createApp(serverPage ? ServerApp : App, serverPage ? { page: serverPage } : {}).use(i18n).mount('#app')
