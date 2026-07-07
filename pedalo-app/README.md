# Application Pédalos

Application simple pour gérer les départs et arrivées des pédalos.

## Fonctionnement

- 19 pédalos pré-enregistrés
- 30 minutes fixes
- Blanc = disponible
- Vert = en navigation
- Rouge = en retard
- Gris = cassé
- Synchronisation temps réel avec Firebase
- Compatible GitHub Pages
- Installable sur téléphone comme une application

## Mise en ligne GitHub Pages

1. Créer un dépôt GitHub
2. Ajouter tous les fichiers
3. Pousser sur GitHub
4. Aller dans Settings > Pages
5. Choisir Deploy from branch
6. Branch: main / root

## Firebase

La configuration Firebase est déjà intégrée dans app.js.

Les règles Realtime Database doivent être :

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
