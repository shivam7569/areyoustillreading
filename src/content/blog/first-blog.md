---
title: "First Blog"
description: "Testing live"
pubDate: "2026-07-27"
tags: []
draft: false
---
This is an example blog to test live website.

$\rho \left( \frac{\partial \mathbf{u}}{\partial t} + \mathbf{u} \cdot \nabla \mathbf{u} \right) = -\nabla p + \mu \nabla^2 \mathbf{u} + \mathbf{f}$

<br />

```python
import numpy as np
import plotly.graph_objects as go

# 1. Generate parameterized coordinates for a Klein Bottle
u = np.linspace(0, np.pi, 100)
v = np.linspace(0, 2 * np.pi, 100)
u, v = np.meshgrid(u, v)

# Parametric equations for the figure-8 immersion of a Klein Bottle
r = 4 - 2 * np.cos(u)
x = (6 * np.cos(u) * (1 + np.sin(u)) + r * np.cos(u) * np.cos(v)) / 10
y = (16 * np.sin(u) + r * np.sin(u) * np.cos(v)) / 10
z = (r * np.sin(v)) / 10

# 2. Construct the 3D Surface Plot
fig = go.Figure(
    data=[
        go.Surface(
            x=x,
            y=y,
            z=z,
            surfacecolor=z,
            colorscale="Viridis",
            colorbar=dict(title="Z Depth"),
            lighting=dict(
                ambient=0.4,
                diffuse=0.8,
                fresnel=0.2,
                specular=0.5,
                roughness=0.1,
            ),
        )
    ]
)

# 3. Apply dark theme and layout settings
fig.update_layout(
    title="3D Parametric Klein Bottle",
    template="plotly_dark",
    autosize=True,
    width=800,
    height=700,
    scene=dict(
        xaxis=dict(title="X", showbackground=False),
        yaxis=dict(title="Y", showbackground=False),
        zaxis=dict(title="Z", showbackground=False),
        aspectmode="data",
    ),
)

# Render the interactive plot in your browser/notebook
fig.show()
```

```d2
# --- GLOBAL STYLING & THEME ---
vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 200
  }
}

classes: {
  microservice: {
    style: {
      fill: "#1e293b"
      stroke: "#38bdf8"
      stroke-width: 2
      font-color: "#f8fafc"
    }
  }
  database: {
    shape: cylinder
    style: {
      fill: "#0f172a"
      stroke: "#a855f7"
      font-color: "#f8fafc"
    }
  }
  queue: {
    shape: queue
    style: {
      fill: "#18181b"
      stroke: "#f59e0b"
      font-color: "#f8fafc"
    }
  }
}

# --- ARCHITECTURE CORE ---

client: API Client / Mobile App {
  shape: person
}

ingress: API Gateway & Load Balancer {
  style.fill: "#334155"
  
  rate_limiter: Redis Rate Limiter {
    class: database
  }
  auth_middleware: OAuth2 / JWT Validator
}

client -> ingress.auth_middleware: 1. POST /order/create {
  style.stroke-dash: 0
}

# --- SERVICES ZONE ---
services: Microservices Mesh {
  style.fill: "#020617"

  order_svc: Order Service {
    class: microservice
  }
  
  inventory_svc: Inventory Service {
    class: microservice
  }
  
  payment_svc: Payment Gateway Integration {
    class: microservice
  }

  cache: Redis Cluster (L2 Cache) {
    class: database
  }

  db_primary: PostgreSQL (Primary) {
    class: database
  }

  db_replica: PostgreSQL (Read Replica) {
    class: database
  }
}

ingress.auth_middleware -> services.order_svc: 2. Authenticated Request

services.order_svc -> services.cache: Read/Write Session State
services.order_svc -> services.inventory_svc: 3. Reserve Stock (gRPC)
services.order_svc -> services.db_primary: 4. Write Order (PENDING)
services.db_primary -> services.db_replica: Streaming Replication {
  style.stroke-dash: 3
}

# --- ASYNC EVENT DRIVEN PROCESSING ---
event_bus: Apache Kafka Cluster {
  class: queue
  
  topic_orders: orders.created.v1
  topic_payments: payments.processed.v1
}

services.order_svc -> event_bus.topic_orders: 5. Publish Event

# --- WORKERS & EXTERNAL PIPELINE ---
workers: Async Background Workers {
  style.fill: "#020617"

  payment_worker: Payment Processing Worker {
    class: microservice
  }

  notification_svc: Push/Email Worker {
    class: microservice
  }
}

external: External Vendors {
  stripe: Stripe API {
    shape: cloud
  }
}

event_bus.topic_orders -> workers.payment_worker: 6. Consume Event
workers.payment_worker -> external.stripe: 7. Charge Credit Card
external.stripe -> workers.payment_worker: 8. Webhook Callback (Success/Fail)

workers.payment_worker -> event_bus.topic_payments: 9. Publish Result
event_bus.topic_payments -> workers.notification_svc: 10. Trigger Notification
```

