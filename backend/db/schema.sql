-- reinicia las tablas para desarrollo local
drop table if exists leads;
drop table if exists agentes;
drop table if exists pesos;

-- guarda los agentes
create table agentes (
  id integer generated always as identity primary key,
  nombre text not null,
  rol text not null check (rol in ('agente', 'admin')),
  token text not null unique
);

-- guarda los leads y los datos para calcular su puntuación
create table leads (
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
  created_at timestamptz not null default now()
);

-- crea índices para optimizar las consultas
create index leads_estado_idx on leads (estado);
create index leads_agente_id_idx on leads (agente_id);

-- guarda los pesos para calcular la puntuación de los leads
create table pesos (
  id integer primary key default 1 check (id = 1),
  peso_cliente_nuevo integer not null check (peso_cliente_nuevo >= 0),
  peso_interes integer not null check (peso_interes >= 0),
  peso_origen integer not null check (peso_origen >= 0),
  peso_antiguedad integer not null check (peso_antiguedad >= 0),
  check (peso_cliente_nuevo + peso_interes + peso_origen + peso_antiguedad = 100)
);

-- crea los pesos iniciales
insert into pesos (peso_cliente_nuevo, peso_interes, peso_origen, peso_antiguedad)
values (40, 30, 20, 10);
