import psycopg2

# === Configuração do Banco ===
DB_CONFIG = {
    "host": "35.226.208.129",
    "user": "postgres",
    "password": "binary@Clock123",
    "dbname": "postgres",
    "port": "5432",
}

class PERIOD:
    DIARIO = "Diário"
    SEMANAL = "Semanal"
    MENSAL = "Mensal"

    @classmethod
    def choices(cls):
        return [
            (cls.DIARIO, "Diário"),
            (cls.SEMANAL, "Semanal"),
            (cls.MENSAL, "Mensal"),
        ]

# === Banco de Dados ===
class DB:
    def __init__(self):
        self.config = DB_CONFIG
        self.conn = None
        self.cursor = None

    def conectar(self):
        try:
            self.conn = psycopg2.connect(**self.config)
            self.cursor = self.conn.cursor()
            print("Conexão com o banco de dados estabelecida.")
        except Exception as e:
            print(f"Erro ao conectar ao banco de dados: {e}")
            raise # Levanta o erro para parar o script se a conexão falhar


    # FUNÇÕES DE INSERÇÃO

    def inserir_monitoramento(
        self, identificador, descricao, inicio, fim, quantidade
    ):
        try:
            self.cursor.execute(
                """
                INSERT INTO monitoramento (identificador, descricao, horario_inicial, horario_final, quantidade)
                VALUES (%s, %s, %s, %s, %s);
            """,
                (identificador, descricao, inicio, fim, quantidade),
            )
            self.conn.commit()
        except Exception as e:
            print(f"Erro ao inserir dados de monitoramento: {e}")

    def inserir_tempo_uso(
        self, identificador, programa_anterior, janela_atual, inicio_janela, fim_janela, duracao, categoria
    ):
        try:
            self.cursor.execute(
                """
                INSERT INTO tempo_uso (identificador, programa, janela, horario_inicial, horario_final, duracao_seg, categoria)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
                (
                    identificador,
                    programa_anterior,
                    janela_atual,
                    inicio_janela,
                    fim_janela,
                    duracao,
                    categoria,
                ),
            )
            self.conn.commit()
        except Exception as e:
            print(f"Erro ao inserir tempo de uso: {e}")

    def inserir_sessao_foco(self, identificador, programa, inicio, fim, duracao):
        try:
            self.cursor.execute(
                """
                INSERT INTO sessoes_foco (identificador, programa, horario_inicial, horario_final, duracao_seg)
                VALUES (%s, %s, %s, %s, %s)
            """,
                (identificador, programa, inicio, fim, duracao),
            )
            self.conn.commit()
        except Exception as e:
            print(f"Erro ao inserir sessão de foco: {e}")
