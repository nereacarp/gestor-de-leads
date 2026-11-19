-- guarda los agentes
create table if not exists agentes (
  id integer generated always as identity primary key,
  nombre text not null,
  rol text not null check (rol in ('agente', 'admin')),
  token text not null unique
);

-- guarda los leads y los datos para calcular su puntuación
create table if not exists leads (
  id integer generated always as identity primary key,
  nombre text not null,
  telefono text not null,
  estado text not null default 'nuevo'
    check (estado in ('nuevo', 'en_gestion', 'contactado', 'cerrado')),
  agente_id integer references agentes (id),
  cliente_nuevo boolean not null,
  interes smallint check (interes between 1 and 5),
  origen text
    check (origen in ('recomendacion', 'web', 'anuncio', 'llamada')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- crea índices para optimizar las consultas
create index if not exists leads_estado_idx on leads (estado);
create index if not exists leads_agente_id_idx on leads (agente_id);

-- guarda los pesos para calcular la puntuación de los leads
create table if not exists pesos (
  id integer primary key default 1 check (id = 1),
  peso_cliente_nuevo integer not null check (peso_cliente_nuevo >= 0),
  peso_interes integer not null check (peso_interes >= 0),
  peso_origen integer not null check (peso_origen >= 0),
  peso_antiguedad integer not null check (peso_antiguedad >= 0),
  check (peso_cliente_nuevo + peso_interes + peso_origen + peso_antiguedad = 100)
);

-- crea los pesos iniciales
insert into pesos (peso_cliente_nuevo, peso_interes, peso_origen, peso_antiguedad)
values (40, 30, 20, 10)
on conflict (id) do nothing;

-- calcula la valoración de cada criterio, la puntuación y la prioridad de cada lead con los pesos actuales
create or replace view leads_puntuados as

select
  t.*,

  -- prioridad según la puntuación: alta desde 75, media desde 40, baja el resto
  case
    when t.puntuacion >= 75 then 'alta'
    when t.puntuacion >= 40 then 'media'
    else 'baja'
  end as prioridad

from (

  -- consulta interna: datos del lead, pesos, valoraciones y puntuación
  select
    l.*,

    p.peso_cliente_nuevo,
    p.peso_interes,
    p.peso_origen,
    p.peso_antiguedad,

    v.val_cliente_nuevo,
    v.val_interes,
    v.val_origen,
    v.val_antiguedad,

    -- puntuación: suma de valoración por peso de cada criterio entre 100
    (
      v.val_cliente_nuevo * p.peso_cliente_nuevo
      + v.val_interes * p.peso_interes
      + v.val_origen * p.peso_origen
      + v.val_antiguedad * p.peso_antiguedad
    )::float8 / 100 as puntuacion

  from leads l

  -- añade a cada lead la fila de pesos
  cross join pesos p

  -- días a partir de los cuales la antigüedad vale 0
  cross join (select 90 as dias_max_antiguedad) c

  -- calcula la valoración de 0 a 100 de cada criterio
  cross join lateral (
    select

      -- cliente nuevo: sí 100, no 0
      case when l.cliente_nuevo then 100 else 0 end as val_cliente_nuevo,

      -- interés de 1 a 5 a 0-100 (sin interés: 0)
      coalesce((l.interes - 1) * 25, 0) as val_interes,

      -- origen: recomendación 100, web 70, anuncio 40, llamada 20 (sin origen: 0)
      case l.origen
        when 'recomendacion' then 100
        when 'web' then 70
        when 'anuncio' then 40
        when 'llamada' then 20
        else 0
      end as val_origen,

      -- antigüedad: 100 hoy, baja de forma lineal por días hasta 0 al llegar a dias_max_antiguedad
      greatest(
        0,
        least(100, 100 - extract(epoch from now() - l.created_at) / 86400 * 100 / c.dias_max_antiguedad)
      )::float8 as val_antiguedad

  ) v

) t;
