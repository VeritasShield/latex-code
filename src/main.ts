import { startBootLoop } from './ui/Launcher';

function bootstrap() {
    try {
        console.info('[LaTeX Converter] Inicializando módulos...');
        startBootLoop();
    } catch (error) {
        console.error('[LaTeX Converter] Error crítico durante la inicialización (bootstrap):', error);
    }
}

bootstrap();