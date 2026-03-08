# 🏆 RoDevs Skill & Ranking Matrix

## Overview
The RoDevs Ranking System is a standardized framework designed to classify the skill level and specialization of Roblox developers. This system ensures transparency for clients and provides a clear career progression path for freelancers.

The system is composed of three distinct layers:
1. **Category:** The broad department (e.g., Programming).
2. **Sub-Category:** The specific specialization (e.g., Systems/Backend).
3. **Tier:** The skill level (e.g., Tier I, Champion).

---

## 📊 Tier Definitions
Ranks are assigned in descending order of seniority (Tier V is entry-level, Champion is the pinnacle).

| Tier Rank | Title | Description | Experience Est. |
| :--- | :--- | :--- | :--- |
| **Champion** | 👑 Elite / Master | The top 1% of talent on the platform. Industry leaders with verified blockbuster titles or major contributions. | 5+ Years |
| **Tier I** | 🥇 Expert | Highly experienced professionals capable of leading teams and architecting complex systems. | 3-5 Years |
| **Tier II** | 🥈 Professional | Fully competent developers who deliver high-quality, bug-free work consistently. | 2-3 Years |
| **Tier III** | 🥉 Advanced | Developers who have moved past the basics and are specializing. Capable of handling standard commissions. | 1-2 Years |
| **Tier IV** | Intermediate | Developers who know the fundamentals but may need supervision or time to solve complex problems. | 6mo - 1 Year |
| **Tier V** | Entry Level | Beginners or hobbyists starting their professional journey. Best for small, low-budget tasks. | < 6 Months |

---

## 🛠️ Specialization Matrix

### 💻 Programming Department
*The logic and engineering backbone of Roblox experiences.*

| Sub-Category | Focus Area |
| :--- | :--- |
| **Gameplay Scripter** | Combat systems, round loops, player interaction, weapons. |
| **Systems/Backend** | DataStores, leaderboards, cross-server messaging, inventory management. |
| **UI Programmer** | Scripting interface behavior, tweening, client-side logic. |
| **Anti-Exploit** | Server-side security, sanity checks, cheat detection. |

### 🏗️ Building Department
*The construction of the 3D world environment.*

| Sub-Category | Focus Area |
| :--- | :--- |
| **Architectural Builder** | Buildings, structures, lobbies, realistic or low-poly construction. |
| **Terrain Artist** | Smooth terrain manipulation, water, lighting, and environmental atmosphere. |
| **Level Designer** | Map flow, spawn placement, difficulty balancing, player guidance. |
| **3D Modeler** | Creating complex meshes (Blender/Maya) for props, weapons, and vehicles. |

### 🎨 Art & Design Department
*The visual identity and user experience.*

| Sub-Category | Focus Area |
| :--- | :--- |
| **UI/UX Designer** | 2D interface design, wireframing, user experience flow (Figma/Photoshop). |
| **VFX Artist** | Particle emitters, beams, trails, magic effects, explosions. |
| **GFX Artist** | Static rendering for game thumbnails, icons, and advertisements. |
| **Animator** | R15/R6 character animation, cutscenes, viewmodels (FPS), rigging. |
| **Clothing Designer** | 2D texture creation for shirts, pants, and classic avatars. |

### 🔊 Audio Department
*The soundscape and immersive elements.*

| Sub-Category | Focus Area |
| :--- | :--- |
| **Sound Designer** | SFX creation (impacts, UI clicks, ambience, footsteps). |
| **Composer** | Original musical scores (OST), looping tracks, adaptive music. |

### 💼 Management Department
*The coordination and quality assurance of projects.*

| Sub-Category | Focus Area |
| :--- | :--- |
| **Game Producer** | Project management, timelines (Jira/Trello), team coordination. |
| **QA Tester** | Bug hunting, reproduction steps, stress testing, playtesting. |
| **Community Manager** | Discord moderation, social media engagement, player feedback. |

---

## 💾 Database Implementation Reference
*For developers working on the backend.*

**Enums Used:**
- `skill_category_enum`
- `skill_subcategory_enum`
- `skill_tier_enum`

**Table Structure:**
The `user_skills` table is a many-to-many relation allowing users to hold multiple ranks across different categories (e.g., a user can be a *Champion Builder* and a *Tier III Scripter*).

**Unique Constraint:**
`PRIMARY KEY (user_id, sub_category)` - A user cannot hold two tiers for the same sub-category.