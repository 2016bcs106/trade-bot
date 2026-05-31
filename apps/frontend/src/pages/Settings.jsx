import { useState } from 'react'
import moment from 'moment'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRotate, faServer, faCog, faCheck } from '@fortawesome/free-solid-svg-icons'
import { db, ref, push } from '../utils/firebase'
import Page from '../components/Page'
import PageHeader from '../components/PageHeader'
import SectionHeader from '../components/SectionHeader'
import { CardList } from '../components/Card'
import ListItem from '../components/ListItem'

export default function Settings() {
  const [updateQueued, setUpdateQueued] = useState(false)

  const handleSystemUpdate = async () => {
    await push(ref(db, 'request_queue'), {
      type: 'system_update',
      payload: {},
      status: 'pending',
      createdAt: moment().utcOffset('+05:30').toISOString(),
    })
    setUpdateQueued(true)
    setTimeout(() => setUpdateQueued(false), 3000)
  }

  return (
    <Page>
      <PageHeader icon={faCog} title="Settings" />

      <SectionHeader>App</SectionHeader>
      <CardList>
        <ListItem
          icon={faRotate}
          iconBg="var(--color-info)"
          title="Force Reload"
          subtitle="Clear cache and reload the page"
          onClick={() => window.location.reload(true)}
          isLast
        />
      </CardList>

      <SectionHeader style={{ marginTop: 'var(--space-xl)' }}>Deploy</SectionHeader>
      <CardList>
        <ListItem
          icon={updateQueued ? faCheck : faServer}
          iconBg={updateQueued ? 'var(--color-success)' : '#8b5cf6'}
          title="System Update"
          subtitle={updateQueued ? 'Update queued! Worker will pull, deploy & restart.' : 'Pull latest code, deploy frontend, restart backend'}
          onClick={!updateQueued ? handleSystemUpdate : undefined}
          isLast
        />
      </CardList>
    </Page>
  )
}
