# ATLAS — Design System & UI Specification

## 1. Propósito

ATLAS Operational Intelligence es un sistema de apoyo operacional para cuentas de call center. Su interfaz debe sentirse como un instrumento de análisis: precisa, sobria, legible y confiable. El producto atiende inicialmente a supervisores, jefes de piso, coordinadores de calidad, operations managers, CEO y administradores.

Esta especificación define la experiencia visual y de interacción del MVP. No define detalles internos de implementación; esos se encuentran en `implementation.md`.

## 2. Principios de diseño

1. **Claridad antes que decoración.** Cada elemento debe ayudar a comprender datos, relaciones o acciones.
2. **Instrumento editorial.** ATLAS evita la apariencia SaaS genérica: usa composición estructurada, tipografía editorial y una paleta inspirada en papel y tinta.
3. **Densidad controlada.** Las vistas analíticas pueden ser densas, pero deben conservar jerarquía, espacio y alineación numérica.
4. **Trazabilidad visible.** Todo KPI, dato e insight debe poder vincularse con su definición, periodo y versión de dataset.
5. **Seguridad comprensible.** Los permisos, estados de publicación y alcance del tenant deben ser explícitos, sin depender solamente del color.
6. **Edición reversible.** Las acciones de configuración relevantes deben incluir borradores, validación y confirmación antes de publicar.
7. **IA verificable.** El chat debe explicar qué herramientas y datos utilizó sin mostrar razonamiento privado del modelo.

## 3. Lenguaje y terminología

- **Organización:** cliente o tenant aislado dentro de ATLAS.
- **Cuenta:** operación o campaña de call center dentro de una organización.
- **Dataset:** conjunto lógico de datos importado y versionado.
- **Carga:** archivo Excel o CSV que produce una versión de dataset.
- **KPI:** métrica publicada en la capa semántica.
- **Campo calculado:** expresión temporal de un widget; no modifica el KPI publicado.
- **Empleado:** persona registrada en el roster de la organización.
- **Dashboard publicado:** versión oficial creada por un administrador.
- **Vista temporal:** cambios locales de layout realizados por usuarios no administradores.

La interfaz inicial estará en español. Los textos se prepararán para internacionalización y no se concatenarán dinámicamente.

## 4. Identidad visual

### 4.1 Paleta

| Token | Valor | Uso |
|---|---:|---|
| `atlas-canvas` | `#F3F0E8` | Fondo general |
| `atlas-surface` | `#FAF8F2` | Paneles, tarjetas, modales |
| `atlas-surface-muted` | `#E9E5DB` | Hover y contenedores secundarios |
| `atlas-border` | `#CBC6B9` | Bordes y separadores |
| `atlas-border-strong` | `#9C978C` | Foco y selección |
| `atlas-ink` | `#1D1D1B` | Texto principal |
| `atlas-ink-secondary` | `#68665F` | Texto secundario |
| `atlas-ink-muted` | `#929087` | Metadatos y placeholders |
| `atlas-accent` | `#365C4A` | Acción primaria y navegación activa |
| `atlas-positive` | `#397052` | Resultados favorables |
| `atlas-warning` | `#A56A2A` | Advertencias y procesamiento |
| `atlas-negative` | `#9A433D` | Errores y acciones destructivas |
| `atlas-info` | `#3E6177` | Información contextual |
| `atlas-focus` | `#2F6FED` | Anillo de foco accesible |

Los estados nunca se comunicarán únicamente mediante color. Deben combinar texto, icono o patrón.

### 4.2 Tipografía

- **Serif:** Instrument Serif, Georgia, serif. Logotipo, títulos principales y cifras destacadas.
- **Sans:** Inter, system-ui, sans-serif. Navegación, formularios y cuerpo.
- **Mono:** ui-monospace, SFMono-Regular, Consolas, monospace. Identificadores, fórmulas, timestamps y datos tabulares técnicos.

Jerarquía recomendada:

- Marca: serif, 30 px, peso 700.
- Título de página: serif, 36–40 px, peso 700.
- Valor KPI: serif, 44–52 px, peso 700.
- Título de sección: sans, 12–14 px, peso 600, mayúsculas espaciadas.
- Cuerpo: sans, 14 px, altura de línea 1.5.
- Metadatos: sans o mono, 10–12 px.

### 4.3 Geometría y elevación

- Radio estándar: 2–3 px.
- Bordes: 1 px con `atlas-border`.
- Sombras reservadas para overlays, menús flotantes y drag previews.
- Espaciado basado en múltiplos de 4 px.
- Iconos lineales, consistentes y acompañados de etiquetas cuando su intención no sea universal.

## 5. Shell y navegación

### 5.1 Escritorio

- Header fijo con marca, organización activa, estado del sistema, ayuda y menú de sesión.
- Sidebar de 256 px con secciones: Dashboards, Análisis, Personas, Administración.
- Área principal con título, contexto, acciones y contenido desplazable.
- Panel lateral derecho opcional para propiedades de widget, definición KPI o fuentes del chat.

### 5.2 Navegación por rol

- **Admin:** acceso completo a datasets, KPI Structure, dashboards, roster y configuración.
- **Supervisor:** dashboards, análisis, roster y perfiles según permisos globales del rol.
- **Jefe de piso:** dashboards, análisis y roster.
- **Coordinador de calidad:** dashboards, análisis de calidad y roster.
- **Operations Manager:** dashboards, análisis y vistas ejecutivas.
- **CEO:** dashboards e indicadores ejecutivos.

En el MVP, el acceso es global por rol dentro de la organización. La jerarquía laboral se usa como dimensión analítica, no como filtro de autorización.

### 5.3 Responsive

- Escritorio es el entorno principal de construcción.
- En tablet, la sidebar se colapsa y los paneles de propiedades se presentan como drawers.
- En móvil, se permite consultar dashboards y chat; construir KPIs o dashboards muestra una vista informativa que recomienda escritorio.
- Las tablas deben permitir scroll horizontal, columnas fijadas y selector de columnas.

## 6. Componentes base

### 6.1 Botones

- Primario: fondo `atlas-accent`, texto claro.
- Secundario: superficie transparente con borde.
- Destructivo: `atlas-negative`, siempre con texto explícito.
- Ghost: para acciones de baja prioridad dentro de tablas o toolbars.
- Estados obligatorios: default, hover, focus-visible, active, disabled y loading.

### 6.2 Formularios

- Etiqueta siempre visible; placeholder no sustituye la etiqueta.
- Mensaje de ayuda y validación próximos al campo.
- Errores explican cómo corregir el valor.
- Selectores con búsqueda para listas extensas.
- Fórmulas e identificadores usan fuente monoespaciada.

### 6.3 Tablas

- Alineación derecha para valores numéricos.
- Encabezado fijo, ordenamiento, filtros, selector de columnas y virtualización.
- Formato consistente para porcentajes, moneda, duración, fechas y valores faltantes.
- `—` representa ausencia de valor; cero se muestra como `0`.
- Acciones de fila disponibles desde menú y teclado.

### 6.4 Feedback

- Toasts para confirmaciones no críticas.
- Banner persistente para fallos parciales o datos desactualizados.
- Modal solo para decisiones destructivas o irreversibles.
- Skeletons que conserven la geometría del contenido.
- Estados vacíos con explicación y siguiente acción según permisos.

## 7. Flujos principales

### 7.1 Ingesta de Excel/CSV

Flujo: seleccionar dataset → subir archivo → detectar hojas y columnas → previsualizar → mapear tipos y claves → validar → elegir estrategia → importar → publicar versión.

La interfaz debe mostrar:

- Nombre, tamaño, hash y fecha del archivo.
- Hojas detectadas y filas de muestra.
- Tipo inferido frente al tipo configurado.
- Errores por fila y columna.
- Estrategias `reemplazar`, `agregar` y `actualizar por clave`.
- Progreso, tiempo aproximado y posibilidad de abandonar la pantalla sin cancelar.
- Resumen final con filas aceptadas, rechazadas y advertencias.

Una carga fallida nunca reemplaza la versión publicada. El reporte de errores debe descargarse.

### 7.2 KPI Structure

El espacio de trabajo tiene tres regiones:

1. Explorador de datasets y KPIs.
2. Canvas de relaciones y dependencias.
3. Panel de propiedades y editor de fórmula.

Cada nodo KPI muestra nombre, estado, unidad, dataset principal y dependencias. Los nodos de dataset muestran campos y claves. Las conexiones representan dependencias KPI o relaciones publicadas entre tablas.

Interacciones:

- Zoom, pan, minimapa, auto-layout y búsqueda.
- Crear KPI desde un nodo o desde una plantilla.
- Conectar tablas solo mediante campos compatibles.
- Mostrar cardinalidad y dirección de join en cada relación.
- Detectar ciclos, rutas ambiguas y campos inexistentes antes de publicar.
- Cambios en borrador con comparación frente a la versión publicada.
- Vista de solo lectura para usuarios no administradores.

### 7.3 Editor de fórmulas

- Editor monoespaciado con autocompletado de funciones, KPIs y columnas.
- Colores por tipo de token, paréntesis pareados y documentación contextual.
- Panel de validación con tipo resultante, dependencias y SQL compilado visible solo en modo técnico administrativo.
- Preview ejecutado sobre datos limitados y claramente etiquetados.
- Errores con posición exacta y corrección sugerida.
- Selector visual complementario para filtros, dimensiones y agregaciones comunes.

### 7.4 Dashboard Builder

- Canvas de doce columnas con drag and drop y tiradores de redimensionamiento.
- Toolbar con deshacer, rehacer, preview, guardar borrador y publicar.
- Biblioteca de widgets: KPI card, tabla, líneas, barras, área, composición, texto/título, insight y filtros.
- Panel de propiedades con fuente, dimensiones, medidas, filtros, formato y comportamiento.
- Indicadores visuales de alineación y colisión durante el arrastre.
- Cambios de administradores persisten como borrador; la publicación crea una versión.
- Cambios de otros usuarios viven únicamente en la sesión del navegador y ofrecen “Restablecer diseño publicado”.

Los gráficos deben incluir título, periodo, unidad, leyenda cuando corresponda, estados sin datos y alternativa tabular accesible.

### 7.5 Agent Definer

- Directorio con búsqueda, filtros por tipo, cuenta, equipo, supervisor y estado.
- Perfil con identidad, relaciones vigentes, historial de cambios y KPIs disponibles.
- Editor administrativo para tipos de empleado y atributos personalizados.
- Visualización jerárquica con fechas de vigencia; no se usa como límite de acceso en el MVP.
- Los datos personales se ocultan parcialmente en listados cuando no sean necesarios.

### 7.6 AI Chat

- Panel conversacional con selector de contexto: organización, cuenta, dashboard o periodo.
- Sugerencias iniciales orientadas a tareas reales, no preguntas genéricas.
- Estado visible mientras el asistente consulta definiciones o ejecuta análisis.
- Las respuestas diferencian hechos, cálculos e interpretación.
- Sección “Fuentes y contexto” con KPI, filtros, periodo, dataset y versión utilizados.
- Acciones: ver datos, abrir KPI, abrir dashboard, copiar respuesta y valorar utilidad.
- Mensajes claros cuando faltan permisos, contexto o datos.
- Nunca mostrar chain-of-thought; solo un resumen breve de la metodología cuando sea útil.

## 8. Estados transversales

- **Loading:** skeleton o progreso determinado según duración.
- **Empty:** explica por qué no hay contenido y quién puede crearlo.
- **Error:** mensaje humano, identificador de incidente y opción de reintento.
- **Partial:** conserva resultados válidos e identifica partes fallidas.
- **Stale:** muestra la versión consultada y permite actualizar.
- **Draft:** etiqueta visible y comparación con publicación.
- **Read-only:** explicación del permiso, no controles falsamente habilitados.

## 9. Accesibilidad

- Objetivo WCAG 2.2 AA.
- Toda funcionalidad operable por teclado.
- Foco visible y orden lógico.
- Drag and drop con controles alternativos para mover y redimensionar.
- Contraste mínimo conforme a AA.
- Gráficos con descripción, tabla alternativa y patrones además de color.
- Mensajes dinámicos anunciados mediante regiones ARIA apropiadas.
- Respeto a `prefers-reduced-motion`.

## 10. Criterios visuales de aceptación

- Tokens centralizados y sin colores arbitrarios en componentes.
- Navegación consistente para todos los roles.
- Estados loading, empty, error, partial y read-only diseñados para cada módulo.
- Flujos críticos utilizables con teclado y lector de pantalla.
- Datos numéricos alineados y formateados consistentemente.
- Toda visualización de IA o KPI muestra contexto y procedencia.
- El constructor funciona en escritorio y conserva una experiencia de consulta clara en pantallas pequeñas.
