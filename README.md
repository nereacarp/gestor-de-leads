# Gestor de leads

Aplicación para gestionar leads comerciales: crearlos, asignarlos a agentes y priorizarlos con una puntuación ponderada cuyos pesos configura un administrador.

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-ADCE9B?style=for-the-badge&logo=node.js&logoColor=303030" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-577AA5?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Fastify-303030?style=for-the-badge&logo=fastify&logoColor=white" alt="Fastify" />
  <img src="https://img.shields.io/badge/React-A0D4D8?style=for-the-badge&logo=react&logoColor=303030" alt="React" />
  <img src="https://img.shields.io/badge/Vite-E78468?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/PostgreSQL-577AA5?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Docker-A0D4D8?style=for-the-badge&logo=docker&logoColor=303030" alt="Docker" />
  <img src="https://img.shields.io/badge/Vitest-ADCE9B?style=for-the-badge&logo=vitest&logoColor=303030" alt="Vitest" />
</p>

## Qué hace

- Crear, consultar y editar leads con validación de datos.
- Listado con filtros por estado y agente, búsqueda por nombre o teléfono, paginación y orden por puntuación.
- Asignar y liberar leads (un lead solo tiene un agente a la vez) y cambiar su estado: `nuevo`, `en_gestion`, `contactado` y `cerrado`.
- Puntuación de 0 a 100, prioridad (alta, media o baja) y desglose por criterio.
- Pantalla de administración para configurar los pesos (solo admin).

## Funcionamiento

**Estados de un lead**

| Estado | Significa | Puede pasar a |
|---|---|---|
| `nuevo` | sin agente | `en_gestion` (al asignarlo) o `cerrado` |
| `en_gestion` | con agente, trabajándolo | `contactado`, `cerrado` o `nuevo` (al liberarlo) |
| `contactado` | con agente, ya contactado | `en_gestion`, `cerrado` o `nuevo` (al liberarlo) |
| `cerrado` | terminado | `en_gestion` o `contactado` (un cerrado sin agente se reabre asignándolo) |

**Asignar y liberar**

| Acción | Resultado |
|---|---|
| Crear un lead sin agente | queda `nuevo` |
| Crear un lead con agente | queda asignado y `en_gestion` |
| Asignar un lead libre o `nuevo` | queda asignado y `en_gestion` |
| Reasignar un lead que ya tiene agente (admin) | cambia de agente y conserva su estado |
| Liberar un lead `en_gestion` o `contactado` | queda sin agente y vuelve a `nuevo` |
| Liberar un lead `cerrado` | queda sin agente y sigue `cerrado` |

**Quién puede hacer qué**

| Acción | Agente | Admin |
|---|---|---|
| Ver listado y ficha | todos los leads | todos los leads |
| Crear lead | libre o asignado a sí mismo | para cualquier agente |
| Editar datos y cambiar estado | los suyos y los libres | cualquiera |
| Asignar | un lead libre, a sí mismo | cualquiera, a cualquier agente |
| Liberar | los suyos | cualquiera |
| Ver y cambiar los pesos | no | sí |

Los leads solo se asignan a agentes, no a administradores. Cada cambio actualiza la fecha de última modificación.

## Instalación y ejecución

### Requisitos

- Node.js 22.22 o superior y npm
- Docker Desktop (para PostgreSQL)

### Ejecución

Desde la carpeta del proyecto, en PowerShell:

```powershell
# 1. base de datos (PostgreSQL 17 en Docker)
docker compose up -d

# 2. backend: API en http://localhost:3000
cd backend
copy .env.example .env      # solo la primera vez
npm install
npm run db:setup            # crea tablas, índices y la vista de puntuación
npm run db:seed             # crea los datos de ejemplo
npm run dev

# 3. frontend (en otra terminal): web en http://localhost:5173
cd frontend
npm install
npm run dev
```

### Configuración

- El backend lee `PORT` y `DATABASE_URL` de `backend/.env` (se crea copiando `backend/.env.example`).
- Las credenciales `leads` / `leads` son de ejemplo, solo para la base de datos local. El `.env` no se sube a Git.
- El frontend no necesita configuración: Vite reenvía `/api` al backend.

### Otros comandos del backend

- `npm run build` y `npm start`: compilan y ejecutan la versión compilada.
- `npm run db:rendimiento -- 50000`: mide el rendimiento con 50.000 leads en una base de datos aparte.

## Autenticación simulada

No hay pantalla de login. Cada usuario tiene un token fijo y funciona así:

1. En la web se elige el usuario en el selector "Usuario de prueba" de la cabecera.
2. La web envía su token en cada petición, en la cabecera `Authorization: Bearer <token>`.
3. El backend busca el token para saber quién es y qué rol tiene, y comprueba que puede hacer lo que pide.
4. Si el token no existe responde 401, y si no tiene permiso, 403.

| Token | Rol |
|---|---|
| `admin-01` | admin |
| `agente-01`, `agente-02`, `agente-03` | agente |

Es solo para desarrollo. En producción habría que usar autenticación real, con contraseña y tokens que caduquen.

## Datos de ejemplo

- `npm run db:seed`: crea 1 admin, 3 agentes y 500 leads con `@faker-js/faker`. Usa una semilla fija, así que salen siempre los mismos datos. Si ya hay datos, no hace nada.
- `npm run db:reset`: borra la base de datos y la deja como nueva, con los datos de ejemplo.

## Arquitectura

```
gestor-de-leads/
├── docker-compose.yml        PostgreSQL para desarrollo
├── backend/
│   ├── db/schema.sql         tablas, reglas (CHECK), índices y vista de puntuación
│   ├── src/
│   │   ├── leads/            un recurso por carpeta (también agentes/ y pesos/)
│   │   ├── db/               conexión y scripts (setup, seed, reset, rendimiento)
│   │   ├── app.ts            construye la API y gestiona los errores
│   │   └── auth.ts           identifica al usuario por su token
│   └── test/                 tests con Vitest
└── frontend/src/
    ├── pantallas/            Listado, Detalle y Pesos
    ├── componentes/          formulario de lead y ventana emergente
    ├── api/                  llamadas al backend y sesión
    ├── App.tsx               rutas y cabecera
    └── estilos.css           estilos y variables de diseño
```

**Backend:** cada recurso (leads, agentes, pesos) se divide en tres archivos.

| Archivo | Qué hace |
|---|---|
| `esquemas.ts` | valida los datos de entrada con Zod |
| `consultas.ts` | consultas SQL directas con la librería `postgres`, sin ORM |
| `rutas.ts` | permisos y códigos de respuesta; une los dos anteriores |

**Frontend:**
- React Router para las pantallas.
- `fetch` con un hook propio (`useApi`) para llamar a la API.
- CSS normal, sin librerías de estilos.

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `leads` | nombre, prefijo y teléfono, estado, agente (opcional), cliente nuevo, interés (1 a 5, opcional), origen (opcional), `version` (control de conflictos al editar), `created_at` y `updated_at` |
| `agentes` | nombre, rol (`agente` o `admin`) y token |
| `pesos` | una sola fila con los cuatro pesos; la base de datos exige que no sean negativos y que sumen 100 |
| `leads_puntuados` (vista) | los leads con sus valoraciones, puntuación y prioridad calculadas con los pesos vigentes |

La base de datos refuerza las reglas con `CHECK`:
- estados y orígenes válidos
- formato del teléfono
- un lead en gestión o contactado siempre tiene agente

## Sistema de pesos y puntuación

La puntuación (de 0 a 100) es la suma de lo que aporta cada criterio: `Σ (valoración del criterio (0 a 100) × peso / 100)`.

| Criterio | Peso inicial | Valoración (0 a 100) |
|---|---|---|
| Cliente nuevo | 40 | sí 100 / no 0 |
| Interés comercial | 30 | 1 = 0 / 2 = 25 / 3 = 50 / 4 = 75 / 5 = 100 |
| Origen del lead | 20 | recomendación 100 / web 70 / anuncio 40 / llamada 20 |
| Antigüedad | 10 | 100 si es de hoy y baja de forma lineal hasta 0 a los 90 días |

- **Prioridad:** alta desde 75, media desde 40 y baja por debajo de 40.
- **Datos ausentes:** si falta el interés o el origen, ese criterio vale 0.
- **Orden:** por puntuación y, si hay empate, por `id`.
- **Cálculo:** siempre en el servidor, en la vista SQL; la API no acepta puntuaciones enviadas por el cliente.
- **Pesos:** `PUT /pesos` rechaza con 400 los pesos negativos, con decimales o que no sumen 100.

## Escenarios y casos límite

- **Dos agentes se asignan el mismo lead a la vez:** la asignación solo se aplica si el lead sigue libre y con la misma versión. Gana una petición y las demás reciben 409.
- **Dos usuarios editan datos desactualizados:** cada cambio manda la versión que vio el usuario y la sube en 1. Si ya no coincide, la API responde 409 con el lead actual y la web permite recargarlo.
- **Un admin cambia los pesos mientras otros consultan:** cada listado se calcula en una sola consulta con los pesos vigentes en ese momento, así que nunca mezcla pesos antiguos y nuevos. Quien ya tenía el listado abierto ve las puntuaciones nuevas al recargarlo.
- **Pesos inválidos o datos incompletos:** la API responde 400 con el motivo de cada campo y no guarda nada. Los datos ausentes valen 0.

## API

Todas las rutas, salvo `/health`, exigen el token. Los errores tienen la forma `{ error, detalles }`:
- 400: datos no válidos
- 401: sin token o token incorrecto
- 403: sin permiso
- 404: no existe
- 409: conflicto de versión (incluye el lead actual)

| Método y ruta | Qué hace |
|---|---|
| `GET /health` | comprueba que el servidor funciona |
| `GET /me`, `GET /agentes` | usuario actual y lista de agentes (filtro `rol`) |
| `GET /leads` | listado con `estado`, `agente`, `q`, `pagina` y `limite` |
| `POST /leads` | crea un lead |
| `GET /leads/:id`, `PUT /leads/:id` | ficha con desglose y edición (con `version`) |
| `POST /leads/:id/asignar`, `POST /leads/:id/liberar` | asignar y liberar (con `version`) |
| `PUT /leads/:id/estado` | cambia el estado (con `version`) |
| `GET /pesos`, `PUT /pesos` | ver y cambiar los pesos (solo admin) |

## Tests

```powershell
docker compose up -d      # los tests usan una base de datos aparte, leads_test
cd backend
npm test
```

Son 190 tests en 12 archivos, con Vitest. Llaman a la API sin arrancar el servidor y usan una base de datos real. Cubren:
- puntuación y orden
- filtros y paginación
- validaciones y permisos
- conflictos de versión y operaciones simultáneas
- cambio de pesos
- reglas de la base de datos

El frontend no tiene tests automáticos pero se ha probado a mano en ordenador y móvil.

## Limitaciones y mejoras

| Limitación | Mejora posible |
|---|---|
| Autenticación simulada: tokens fijos | Autenticación real, con contraseña y tokens que caduquen |
| La `version` es del lead entero: si uno edita y otro asigna a la vez, el segundo recibe 409 aunque no se pisen | Fusionar los cambios que no chocan |
| La pantalla no se actualiza sola | Avisos de modificación o actualización automática cada poco tiempo |
| La paginación usa `OFFSET`: si cambian los datos o los pesos entre páginas, algún lead puede repetirse o saltarse | Paginación por cursor, y fijar los pesos o guardar la puntuación para que el orden no cambie entre páginas |
| La búsqueda por texto (`ilike '%texto%'`) no usa índices | Índice `pg_trgm` |
| La puntuación se calcula al leer: con millones de leads sería lenta | Guardarla ya calculada |
| No se distingue un lead cerrado "conseguido" de uno "descartado" | Campo de resultado o estado `descartado` |
| El proxy de Vite solo sirve en desarrollo | Servir la web y la API juntas, o configurar CORS |
| Añadir un criterio de puntuación exige tocar el esquema, el cálculo y la validación | Criterios editables desde la pantalla |
| El frontend no tiene tests automáticos | Añadirlos |
