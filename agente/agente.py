# agente.py

import threading
import time
import socket
from db import DB
from monitorator import Monitorator

def obter_identificador():
    """Retorna o hostname da máquina como identificador único."""
    try:
        return socket.gethostname()
    except Exception as e:
        print(f"Erro ao obter identificador: {e}")
        return "id_desconhecido"

if __name__ == "__main__":
    print("Iniciando agente de monitoramento em segundo plano...")
    
    try:
        identificador_maquina = obter_identificador()
        print(f"Identificador desta máquina: {identificador_maquina}")

        db = DB()
        db.conectar()

        monitorator = Monitorator(db)

        # --- Define as funções que rodarão em threads ---

        # Thread 1: Monitora Teclas e Cliques em ciclos
        def run_monitoramento_interacoes():
            print("Thread de interações (teclas/cliques) iniciada.")
            while True:
                try:
                    monitorator.monitorar_interacoes(identificador_maquina, duracao_segundos=60)
                except Exception as e:
                    print(f"Erro na thread de interações: {e}")
                    time.sleep(60) # Espera antes de tentar novamente

        # Thread 2: Monitora Janelas Ativas e Sessões de Foco
        def run_monitoramento_atividade():
            print("Thread de atividade (janelas/foco) iniciada.")
            while True:
                try:
                    monitorator.monitorar_atividade_janelas(identificador_maquina, intervalo_segundos=5, foco_minutos=10)
                except Exception as e:
                    print(f"Erro na thread de atividade: {e}")
                    time.sleep(60) # Espera antes de tentar novamente

        # --- Inicia as threads ---
        
        threading.Thread(target=run_monitoramento_interacoes, daemon=True).start()
        threading.Thread(target=run_monitoramento_atividade, daemon=True).start()

        print("Monitoramento iniciado com sucesso.")

        # Mantém o script principal vivo para que as threads continuem rodando
        while True:
            time.sleep(3600) # Apenas "dorme" por uma hora, indefinidamente

    except Exception as e:
        # Se algo falhar no setup inicial (ex: conexão com DB), o script vai parar.
        
        print(f"Erro fatal ao iniciar o agente: {e}")
        time.sleep(60) # Espera 60 segundos antes de fechar