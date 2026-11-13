"""Configuración central (12-factor): todo viene de variables de entorno / archivo .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/crm/config.py -> raíz del repositorio
ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # --- Aplicación -------------------------------------------------------------
    app_name: str = "FORTUNER CRM"
    environment: str = Field("production", alias="CRM_ENV")
    host: str = Field("127.0.0.1", alias="CRM_HOST")
    port: int = Field(8900, alias="CRM_PORT")
    cors_origins: str = Field("", alias="CRM_CORS_ORIGINS")
    log_level: str = Field("INFO", alias="CRM_LOG_LEVEL")

    # --- Seguridad --------------------------------------------------------------
    api_key: str = Field("", alias="CRM_API_KEY")
    admin_key: str = Field("", alias="CRM_ADMIN_KEY")
    ia_rate_limit: int = Field(30, alias="CRM_IA_RATE_LIMIT")

    # --- Contexto comercial -----------------------------------------------------
    ciudad: str = Field("Manizales", alias="CRM_CIUDAD")
    departamento: str = Field("Caldas", alias="CRM_DEPARTAMENTO")

    # --- Datos ------------------------------------------------------------------
    data_dir: Path = Field(ROOT_DIR / "data", alias="CRM_DATA_DIR")
    etl_meses: int = Field(36, alias="CRM_ETL_MESES")

    # --- Fuente: Advantage Database Server (ERP FORTUNER, diccionario PUBLIDATA) -
    ads_driver: str = Field("Advantage StreamlineSQL ODBC", alias="ADS_DRIVER")
    ads_data_directory: str = Field("", alias="ADS_DATA_DIRECTORY")
    ads_user: str = Field("", alias="ADS_USER")
    ads_password: str = Field("", alias="ADS_PASSWORD")
    ads_server_types: str = Field("2", alias="ADS_SERVER_TYPES")
    ads_comm_type: str = Field("TCP_IP", alias="ADS_COMM_TYPE")
    ads_fetch_size: int = Field(20_000, alias="ADS_FETCH_SIZE")
    ads_page_size: int = Field(20_000, alias="ADS_PAGE_SIZE")

    # --- Clientes 360°: diccionario propio del CRM y catálogos de GANAPTOS ----------
    # Diccionario del CRM (tablas CRM_*). Lo crea `crm clientes instalar`; nunca se mezcla con PUBLIDATA.
    ads_crm_directory: str = Field("", alias="ADS_CRM_DIRECTORY")
    ads_crm_user: str = Field("AdsSys", alias="ADS_CRM_USER")
    ads_crm_password: str = Field("", alias="ADS_CRM_PASSWORD")
    # Carpeta de tablas libres de GANAPTOS (GANMASCOTA, GANPROFE, GANAUTOS, GANBARRIO, CIUDAD, DPTOS). Solo lectura.
    ads_catalogos_directory: str = Field("", alias="ADS_CATALOGOS_DIRECTORY")
    # Interruptor maestro: sin él, Clientes 360° es de solo lectura aunque todo lo demás esté configurado.
    clientes_escritura: bool = Field(False, alias="CRM_CLIENTES_ESCRITURA")
    clientes_refresco_min: int = Field(15, alias="CRM_CLIENTES_REFRESCO_MIN")
    clientes_sucursal_alta: str = Field("", alias="CRM_CLIENTES_SUCURSAL_ALTA")

    # --- IA (API compatible con OpenAI: DeepSeek por defecto) -------------------
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    deepseek_api_key: str = Field("", alias="DEEPSEEK_API_KEY")
    llm_base_url: str = Field("https://api.deepseek.com", alias="LLM_BASE_URL")
    llm_model: str = Field("deepseek-chat", alias="LLM_MODEL")
    llm_timeout_seconds: float = Field(90, alias="LLM_TIMEOUT")

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def effective_llm_key(self) -> str:
        return self.llm_api_key or self.deepseek_api_key

    @property
    def warehouse_dir(self) -> Path:
        return self.data_dir / "warehouse"

    @property
    def staging_dir(self) -> Path:
        return self.data_dir / "staging"

    @property
    def store_path(self) -> Path:
        return self.data_dir / "crm.sqlite"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip() and o.strip() != "*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
