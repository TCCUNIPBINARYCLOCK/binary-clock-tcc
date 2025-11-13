# monitorator.py

from pynput import keyboard, mouse
from pynput.keyboard import Key
from datetime import datetime, timedelta
import time
import psutil
import win32gui
import win32process
from pynput import keyboard, mouse
from db import DB


class Monitorator:
    def __init__(self, db):
        self.db: DB = db

    def monitorar_interacoes(self, identificador, duracao_segundos=60):
        # Dicionário de contadores para cada categoria
        contadores = {
            "alfanumericas": 0, # A-Z, 0-9
            "navegacao": 0,     # Setas, Home, End, PageUp/Down
            "edicao": 0,        # Backspace, Delete, Tab, Enter, Space
            "modificadoras": 0, # Ctrl, Alt, Shift, Cmd
            "funcao": 0,        # F1-F12
            "outras": 0,        # Esc, PrtScn, etc.
        }
        contador_cliques = 0
        inicio = datetime.now()

        # 2. Sets de teclas para categorização rápida
        NAV_KEYS = {
            Key.up, Key.down, Key.left, Key.right,
            Key.home, Key.end, Key.page_up, Key.page_down
        }
        EDIT_KEYS = {
            Key.backspace, Key.delete, Key.tab, Key.enter, Key.space
        }
        MOD_KEYS = {
            Key.ctrl, Key.ctrl_l, Key.ctrl_r,
            Key.alt, Key.alt_l, Key.alt_r, Key.alt_gr,
            Key.shift, Key.shift_l, Key.shift_r,
            Key.cmd, Key.cmd_l, Key.cmd_r
        }
        FUNC_KEYS = {
            Key.f1, Key.f2, Key.f3, Key.f4, Key.f5, Key.f6,
            Key.f7, Key.f8, Key.f9, Key.f10, Key.f11, Key.f12
        }

        def on_press(key):
            nonlocal contadores
            
            # Tenta verificar se é uma tecla de caractere (A, 1, $, etc.)
            try:
                if key.char and key.char.isalnum():
                    contadores["alfanumericas"] += 1
                else:
                    # Pontuação ou símbolos
                    contadores["outras"] += 1
            
            # Se não for, é uma tecla especial (Enter, Ctrl, F1, etc.)
            except AttributeError:
                if key in NAV_KEYS:
                    contadores["navegacao"] += 1
                elif key in EDIT_KEYS:
                    contadores["edicao"] += 1
                elif key in MOD_KEYS:
                    contadores["modificadoras"] += 1
                elif key in FUNC_KEYS:
                    contadores["funcao"] += 1
                else:
                    # Outras teclas especiais (Esc, PrtScn, etc.)
                    contadores["outras"] += 1

        # Função de clique
        def on_click(x, y, button, pressed):
            nonlocal contador_cliques
            if pressed:
                contador_cliques += 1

        # Inicia os listeners
        keyboard_listener = keyboard.Listener(on_press=on_press)
        mouse_listener = mouse.Listener(on_click=on_click)
        keyboard_listener.start()
        mouse_listener.start()

        time.sleep(duracao_segundos)

        keyboard_listener.stop()
        mouse_listener.stop()

        fim = datetime.now()

        # 4. Insere os dados de cada categoria de tecla no banco
        # (Apenas insere se a contagem for maior que zero)
        for categoria, quantidade in contadores.items():
            if quantidade > 0:
                descricao = f"teclas_{categoria}" # Ex: "teclas_alfanumericas"
                self.db.inserir_monitoramento(identificador, descricao, inicio, fim, quantidade)

        # 5. Insere os dados de clique
        if contador_cliques > 0:
            self.db.inserir_monitoramento(identificador, "contagem_cliques", inicio, fim, contador_cliques)

        print(f"Interações registradas no período: {contador_cliques} cliques e dados de categorias de teclas.")
    

    def obter_janela_ativa(self):
        try:
            hwnd = win32gui.GetForegroundWindow()
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            processo = psutil.Process(pid)
            nome_programa = processo.name()
            nome_janela = win32gui.GetWindowText(hwnd)
            return nome_programa, nome_janela
        except (psutil.NoSuchProcess, psutil.AccessDenied, win32process.error):
            return None, None
        

    
    # FUNÇÃO DE CATEGORIZAÇÃO
   
    def categorizar_atividade(self, programa, janela_titulo):
        """
        Analisa o programa e o título da janela para retornar uma categoria de atividade.
        """
        if not programa or not janela_titulo:
            return "Outros"

        # Converte para minúsculas para facilitar a comparação
        programa = programa.lower()
        janela = janela_titulo.lower()

        # Categoria 1: Codificação (Produtivo)
        if "code.exe" in programa or "pycharm64.exe" in programa or \
           "sublime_text.exe" in programa or "notepad++.exe" in programa:
            return "Codificação"
        
        # Categoria 2: Pesquisa Técnica (Produtivo)
        # Verificando navegadores
        if "chrome.exe" in programa or "firefox.exe" in programa or "msedge.exe" in programa:
            if "stack overflow" in janela or "github" in janela or \
               "w3schools" in janela or "python.org" in janela or \
               "medium.com" in janela or "docs.microsoft.com" in janela:
                return "Pesquisa Técnica"
            
            # Categoria 3: Entretenimento (Pausa/Distração)
            if "youtube.com" in janela or "netflix.com" in janela or \
               "twitch.tv" in janela or "twitter.com" in janela:
                return "Entretenimento"

            # Categoria 4: E-mail (Comunicação)
            if "mail.google.com" in janela or "outlook.live.com" in janela:
                return "Email"

            # Se for navegador mas não se encaixar, é genérico
            return "Navegação (Web)"

        # Categoria 5: Comunicação (Necessário)
        if "slack.exe" in programa or "teams.exe" in programa:
            return "Comunicação (Chat)"
        if "outlook.exe" in programa:
            return "Email"

        # Categoria 6: Música (Neutro)
        if "spotify.exe" in programa:
            return "Música"

        # Categoria 7: Sistema (Neutro)
        if "explorer.exe" in programa or "powershell.exe" in programa or "cmd.exe" in programa:
            return "Sistema/Arquivos"
        
        # Se não se encaixar em nada
        return "Outros"

    # FUNÇÃO DETECTA JANELAS DE FOCO
    def monitorar_atividade_janelas(self, identificador, intervalo_segundos=5, foco_minutos=10):
        print("Monitor de atividade de janelas e foco iniciado.")
        
        programa_anterior, janela_anterior = None, None
        inicio_atividade = datetime.now()
        
        # O tempo mínimo em segundos para ser considerado uma sessão de foco
        foco_threshold_seg = foco_minutos * 60

        while True:
            programa_atual, janela_atual = self.obter_janela_ativa()

            # Se a janela ou programa mudou, encerra a atividade anterior e inicia uma nova
            if programa_atual != programa_anterior and programa_anterior is not None:
                fim_atividade = datetime.now()
                duracao = (fim_atividade - inicio_atividade).total_seconds()
                

            # 1. Categoriza a atividade anterior
                categoria = self.categorizar_atividade(programa_anterior, janela_anterior)

            # 2. Insere o tempo de uso da janela anterior
                self.db.inserir_tempo_uso(
                identificador,
                programa_anterior,
                janela_anterior,
                inicio_atividade,
                fim_atividade,
                duracao,
                categoria, 
            )
                print(f"Registrado uso de '{programa_anterior}' [Categoria: {categoria}] por {duracao:.1f}s.")

                # 2. Verifica se a atividade anterior foi uma sessão de foco
                if duracao >= foco_threshold_seg:
                    self.db.inserir_sessao_foco(
                        identificador,
                        programa_anterior,
                        inicio_atividade,
                        fim_atividade,
                        duracao,
                    )
                    print(f"*** Sessão de Foco em '{programa_anterior}' registrada! Duração: {duracao/60:.1f} min ***")

                # Reinicia o contador para a nova atividade
                inicio_atividade = datetime.now()

            programa_anterior = programa_atual
            janela_anterior = janela_atual

            time.sleep(intervalo_segundos)